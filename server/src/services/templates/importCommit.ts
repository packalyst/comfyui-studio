// Commit path for a staged import: persist chosen workflows via
// `saveUserWorkflow` and (optionally) copy reference images into ComfyUI's
// input/ directory.
//
// Every write goes through `safeResolve(COMFYUI_PATH, 'input')` so a
// crafted image filename cannot escape the input root.

import fs from 'fs';
import { safeResolve } from '../../lib/fs.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { extractDeps } from './depExtract.js';
import { resolutionsToRepoKeys } from './extractDepsAsync.js';
import { extractWorkflowIo, deriveMediaType, mediaTypeToStudioCategory } from './metadata.js';
import { saveUserWorkflow, slugifyTemplateName } from './userTemplates.js';
import { consumeStaging, type StagedImport } from './importStaging.js';
import { rewriteLoadImageReferences } from './rewriteLoadImage.js';
import type { TemplatePluginEntry } from './types.js';

export interface CommitSelection {
  /** Indices into `staged.workflows` to import. */
  workflowIndices: number[];
  /** When true, reference images are copied into `${COMFYUI_PATH}/input/`. */
  imagesCopy: boolean;
}

export interface CommitResult {
  imported: string[];
  imagesCopied: string[];
}

function inputDir(): string {
  return safeResolve(env.COMFYUI_PATH, 'input');
}

function copyImagesFor(staged: StagedImport, slug: string, imagesCopy: boolean): string[] {
  if (!imagesCopy || staged.images.length === 0) return [];
  const copied: string[] = [];
  let root: string;
  try { root = inputDir(); }
  catch (err) {
    logger.warn('import commit: input dir unavailable', { error: String(err) });
    return [];
  }
  try { fs.mkdirSync(root, { recursive: true }); } catch { /* best effort */ }
  for (const img of staged.images) {
    const outName = `${slug}__${img.name}`;
    let target: string;
    try { target = safeResolve(root, outName); } catch { continue; }
    try {
      fs.writeFileSync(target, Buffer.from(img.bytes), { mode: 0o644 });
      copied.push(outName);
    } catch (err) {
      logger.warn('import commit: image copy failed', { name: outName, error: String(err) });
    }
  }
  return copied;
}

/**
 * Commit the chosen workflows + images. The staged row is consumed (removed)
 * even on partial success — the frontend should re-stage if the user needs to
 * retry, since image bytes are dropped along with the row.
 */
export async function commitStaging(id: string, selection: CommitSelection): Promise<CommitResult> {
  const staged = consumeStaging(id);
  if (!staged) throw new Error('Staging not found or expired');

  const imported: string[] = [];
  const imagesCopied: string[] = [];
  const thumbnails = staged.defaultThumbnail ? [staged.defaultThumbnail] : [];
  const alreadyCopied = new Set<string>();

  for (const idx of selection.workflowIndices) {
    const wf = staged.workflows[idx];
    if (!wf) continue;
    // Compute the slug first so we can build the LoadImage rename map
    // consistently with the filenames that land in ComfyUI/input/.
    const tentativeSlug = slugifyTemplateName(wf.title || wf.entryName);
    // Build the image rename map only when we're actually copying images —
    // no rename happens on disk if copyImages is off, so the workflow must
    // keep pointing at the original filenames. The `copyImagesFor` helper
    // uses the same `<slug>__<name>` policy so this mapping matches 1:1.
    const renameMap: Record<string, string> = {};
    if (selection.imagesCopy && staged.images.length > 0) {
      for (const img of staged.images) {
        renameMap[img.name] = `${tentativeSlug}__${img.name}`;
      }
    }
    const rewrittenWorkflow = Object.keys(renameMap).length > 0
      ? (rewriteLoadImageReferences(wf.workflow, renameMap) as Record<string, unknown>)
      : wf.workflow;
    const io = extractWorkflowIo(rewrittenWorkflow);
    const mediaType = deriveMediaType(io);
    const studioCat = mediaTypeToStudioCategory(mediaType);
    const deps = extractDeps(rewrittenWorkflow);
    // Preserve the Manager-resolved plugin list from staging. We don't
    // re-run resolution here because (a) it's slower, (b) Manager may have
    // gone offline between staging + commit, and (c) the user already
    // reviewed the list. `resolutionsToRepoKeys` collapses the detailed
    // match structures into the string form persisted in `template_plugins`
    // so readiness tracking has the same edges the resolver produced.
    const pluginEntries: TemplatePluginEntry[] = [];
    for (const r of wf.plugins) {
      for (const m of r.matches) {
        if (!pluginEntries.some((e) => e.repo === m.repo)) {
          pluginEntries.push({ repo: m.repo, title: m.title, cnr_id: m.cnr_id });
        }
      }
    }
    const pluginRepoKeys = resolutionsToRepoKeys(wf.plugins);
    const saved = saveUserWorkflow({
      name: wf.title || wf.entryName,
      title: wf.title || wf.entryName,
      description: wf.description ?? staged.defaultDescription ?? '',
      workflow: rewrittenWorkflow,
      sourceUrl: staged.sourceUrl,
      tags: staged.defaultTags,
      io,
      mediaType,
      studioCategory: studioCat,
      models: deps.models,
      plugins: pluginEntries,
      thumbnail: thumbnails,
    });
    imported.push(saved.name);
    // Persist the template_plugins edges so readiness + the
    // install-missing-plugins route can find them. Lazy import keeps this
    // file cheap to import in tests that only exercise staging.
    try {
      const repo = await import('../../lib/db/templates.repo.js');
      const existing = repo.getTemplate(saved.name);
      if (existing) {
        repo.upsertTemplate(
          {
            name: saved.name,
            displayName: existing.displayName,
            category: existing.category ?? saved.category ?? null,
            description: existing.description ?? saved.description ?? null,
            source: existing.source ?? 'open',
            workflow_json: existing.workflow_json ?? null,
            tags_json: existing.tags_json ?? JSON.stringify(saved.tags ?? []),
            installed: existing.installed,
          },
          { models: deps.models, plugins: pluginRepoKeys },
        );
      }
    } catch (err) {
      logger.warn('import commit: template_plugins edge write skipped', {
        name: saved.name, error: err instanceof Error ? err.message : String(err),
      });
    }
    const slug = slugifyTemplateName(saved.name);
    const copiedForThis = copyImagesFor(staged, slug, selection.imagesCopy);
    for (const c of copiedForThis) {
      if (!alreadyCopied.has(c)) {
        alreadyCopied.add(c);
        imagesCopied.push(c);
      }
    }
  }

  return { imported, imagesCopied };
}
