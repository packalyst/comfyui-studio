// Handler + wiring for `POST /templates/import-civitai` and
// `DELETE /templates/:name` (user-workflow-only).
//
// Kept separate from `templates.routes.ts` so the latter stays within the
// 250-line structure cap. Both handlers are re-mounted by the main router
// under the `/launcher/...` alias so catch-all-proxy clients reach them too.

import type { Request, Response } from 'express';
import JSZip from 'jszip';
import * as templates from '../services/templates/index.js';
import * as settings from '../services/settings.js';
import * as civitai from '../services/civitai/civitai.service.js';
import { fetchWithRetry, getCivitaiAuthHeaders } from '../lib/http.js';
import { env } from '../config/env.js';
import { sendError } from '../middleware/errors.js';

const ZIP_MAX_BYTES = 20 * 1024 * 1024; // 20 MB — civitai workflow packs are usually <5 MB

function resolveVersionId(body: unknown): string {
  const b = (body || {}) as { workflowVersionId?: string | number };
  const raw = b.workflowVersionId;
  return raw != null ? String(raw) : '';
}

function looksLikeLitegraph(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const nodes = (value as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return false;
  return nodes.length === 0 || (typeof nodes[0] === 'object' && nodes[0] !== null);
}

/**
 * Walk the zip's entries and return the largest JSON file whose contents parse
 * as a LiteGraph workflow document. Ignores directories, non-JSON files, and
 * JSON that isn't shaped like a workflow.
 */
async function pickWorkflowFromZip(
  zipBytes: ArrayBuffer,
): Promise<{ workflow: Record<string, unknown>; entryName: string } | { rejected: string[] }> {
  const zip = await JSZip.loadAsync(zipBytes);
  const candidates: Array<{ name: string; size: number; workflow: Record<string, unknown> }> = [];
  const allNames: string[] = [];
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    allNames.push(name);
    if (!/\.json$/i.test(name)) continue;
    const text = await entry.async('string');
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { continue; }
    if (!looksLikeLitegraph(parsed)) continue;
    candidates.push({ name, size: text.length, workflow: parsed });
  }
  if (candidates.length === 0) return { rejected: allNames };
  // Largest wins — usually the full workflow, smaller JSONs are meta/preview.
  candidates.sort((a, b) => b.size - a.size);
  return { workflow: candidates[0].workflow, entryName: candidates[0].name };
}

async function fetchRemoteBytes(
  url: string,
  maxBytes: number,
  extraHeaders: Record<string, string>,
): Promise<ArrayBuffer> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: extraHeaders,
    });
    if (!res.ok) throw new Error(`upstream ${res.status} ${res.statusText}`);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) {
      throw new Error(`payload too large: ${buf.byteLength} > ${maxBytes}`);
    }
    return buf;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Flow:
 *   1. Resolve version via `/api/v1/model-versions/:id`.
 *   2. If the primary file is JSON → fetch + validate directly.
 *   3. If the file is a ZIP (the civitai-normal case) → download, unzip
 *      in-memory, pick the largest LiteGraph-shaped JSON inside.
 *   4. Persist via `saveUserWorkflow`; refresh template cache.
 */
export async function handleImportCivitai(req: Request, res: Response): Promise<void> {
  try {
    const versionId = resolveVersionId(req.body);
    if (!versionId) {
      res.status(400).json({ error: 'workflowVersionId is required' });
      return;
    }

    const meta = await civitai.getWorkflowVersionFile(versionId);
    const civitaiToken = settings.getCivitaiToken();
    const authHeaders = getCivitaiAuthHeaders(meta.downloadUrl, civitaiToken);

    let workflowDoc: Record<string, unknown>;

    if (meta.isJsonFile) {
      const fetched = await fetchWithRetry(meta.downloadUrl, {
        attempts: 3,
        baseDelayMs: 500,
        timeoutMs: 30_000,
        maxBytes: env.CIVITAI_MAX_RESPONSE_BYTES,
        headers: { Accept: 'application/json', ...authHeaders },
      });
      let parsed: unknown;
      try { parsed = JSON.parse(fetched.text); }
      catch (err) {
        res.status(400).json({
          error: `Workflow file was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
      if (!looksLikeLitegraph(parsed)) {
        res.status(400).json({
          error: 'Workflow JSON has no top-level `nodes` array; not a LiteGraph document.',
        });
        return;
      }
      workflowDoc = parsed as Record<string, unknown>;
    } else {
      const isZip = meta.type === 'Archive' || /\.zip$/i.test(meta.fileName ?? '');
      if (!isZip) {
        res.status(415).json({
          error: 'Unsupported workflow file type.',
          fileName: meta.fileName,
          type: meta.type,
        });
        return;
      }
      let zipBytes: ArrayBuffer;
      try {
        zipBytes = await fetchRemoteBytes(meta.downloadUrl, ZIP_MAX_BYTES, {
          Accept: 'application/octet-stream',
          ...authHeaders,
        });
      } catch (err) {
        res.status(502).json({
          error: `Failed to download zip: ${err instanceof Error ? err.message : String(err)}`,
          fileName: meta.fileName,
        });
        return;
      }
      let result;
      try { result = await pickWorkflowFromZip(zipBytes); }
      catch (err) {
        res.status(400).json({
          error: `Zip archive could not be opened: ${err instanceof Error ? err.message : String(err)}`,
          fileName: meta.fileName,
        });
        return;
      }
      if ('rejected' in result) {
        res.status(415).json({
          error: 'No LiteGraph workflow JSON found inside the zip.',
          fileName: meta.fileName,
          entries: result.rejected.slice(0, 50),
        });
        return;
      }
      workflowDoc = result.workflow;
    }

    const saved = templates.saveUserWorkflow({
      name: meta.modelName || `civitai-${versionId}`,
      title: meta.modelName || `CivitAI Workflow ${versionId}`,
      description: `Imported from civitai.com (model version ${versionId}).`,
      workflow: workflowDoc,
      sourceUrl: `https://civitai.com/models/${meta.modelId ?? ''}?modelVersionId=${versionId}`,
    });

    try { await templates.refreshTemplates(); }
    catch { /* best effort */ }

    res.json({ name: saved.name, imported: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Missing workflow version ID|not valid JSON|no top-level|nodes array/.test(msg)) {
      res.status(400).json({ error: msg });
      return;
    }
    sendError(res, err, 502, 'Workflow import failed');
  }
}

/**
 * DELETE /templates/:name — removes a user-imported workflow. Upstream
 * ComfyUI templates cannot be removed (403).
 */
export function handleDeleteTemplate(req: Request, res: Response): void {
  const name = req.params.name as string;
  if (!templates.isUserWorkflow(name)) {
    res.status(403).json({ error: 'Only user-imported templates can be deleted' });
    return;
  }
  const removed = templates.deleteUserWorkflow(name);
  if (!removed) {
    res.status(404).json({ error: `Template not found: ${name}` });
    return;
  }
  templates.loadTemplatesFromComfyUI(env.COMFYUI_URL).catch(() => { /* best effort */ });
  res.json({ deleted: true, name });
}
