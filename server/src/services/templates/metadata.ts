// Workflow metadata extraction for imported user workflows.
//
// Given a LiteGraph document we derive:
//   - `io.inputs`  — user-facing loader nodes (LoadImage / LoadVideo / LoadAudio)
//   - `io.outputs` — save nodes (SaveImage / SaveVideo / SaveAudio / PreviewImage)
//   - `mediaType`  — "image" / "video" / "audio" derived from the dominant
//                    output node type; falls back to "image".
//   - `studioCategory` — mirrors `mapCategory` in templates.service.ts so
//                    import-staged templates sort into the same sidebar bucket
//                    as upstream ones with the same mediaType.
//
// Pure: no I/O. Used by the staging commit path so user imports carry the
// same non-wire metadata (and therefore the same form inputs) as upstream.

import { collectAllWorkflowNodes } from '../workflow/collect.js';
import type { WorkflowNode } from '../../contracts/workflow.contract.js';

export interface WorkflowIo {
  inputs: Array<{ nodeId: number; nodeType: string; file?: string; mediaType: string }>;
  outputs: Array<{ nodeId: number; nodeType: string; file: string; mediaType: string }>;
}

export type MediaType = 'image' | 'video' | 'audio';
export type StudioCategory = 'image' | 'video' | 'audio' | '3d' | 'tools';

// Node-type prefixes / classes treated as save nodes. We keep the list
// prefix-matched so vendored ports (e.g. `VHS_VideoCombine`) are picked up
// without maintaining a hard-coded union. Input classification lives in
// `classifyInput` below since it has more edge cases.
const OUTPUT_TYPES: Array<{ match: (t: string) => boolean; mediaType: MediaType }> = [
  { match: (t) => /^SaveImage$/i.test(t) || /^PreviewImage$/i.test(t), mediaType: 'image' },
  { match: (t) => /SaveVideo/i.test(t) || /VHS_VideoCombine/i.test(t), mediaType: 'video' },
  { match: (t) => /SaveAudio/i.test(t), mediaType: 'audio' },
];

function nodeType(node: WorkflowNode): string {
  const t = (node.type as string | undefined) ?? (node.class_type as string | undefined);
  return typeof t === 'string' ? t : '';
}

function nodeId(node: WorkflowNode): number {
  const id = (node as { id?: unknown }).id;
  if (typeof id === 'number' && Number.isFinite(id)) return id;
  if (typeof id === 'string') {
    const n = parseInt(id, 10);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

function firstWidgetString(node: WorkflowNode): string | undefined {
  if (!Array.isArray(node.widgets_values)) return undefined;
  for (const v of node.widgets_values) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

function classifyInput(t: string): MediaType | null {
  if (/^LoadImage/i.test(t)) return 'image';
  if (/LoadVideo/i.test(t) || /VHS_LoadVideo/i.test(t)) return 'video';
  if (/LoadAudio/i.test(t) || /VHS_LoadAudio/i.test(t)) return 'audio';
  return null;
}

function classifyOutput(t: string): MediaType | null {
  for (const r of OUTPUT_TYPES) if (r.match(t)) return r.mediaType;
  return null;
}

/**
 * Walk every node in the workflow (including nested subgraphs) and classify
 * inputs/outputs. `file` on inputs is the first widget string (ComfyUI stores
 * the selected upload filename there); on outputs it's the filename prefix
 * widget.
 */
export function extractWorkflowIo(workflow: unknown): WorkflowIo {
  const out: WorkflowIo = { inputs: [], outputs: [] };
  if (!workflow || typeof workflow !== 'object') return out;
  const nodes = collectAllWorkflowNodes(workflow as Record<string, unknown>);
  for (const node of nodes) {
    const t = nodeType(node);
    if (!t) continue;
    const inKind = classifyInput(t);
    if (inKind) {
      out.inputs.push({
        nodeId: nodeId(node),
        nodeType: t,
        file: firstWidgetString(node),
        mediaType: inKind,
      });
      continue;
    }
    const outKind = classifyOutput(t);
    if (outKind) {
      out.outputs.push({
        nodeId: nodeId(node),
        nodeType: t,
        file: firstWidgetString(node) ?? '',
        mediaType: outKind,
      });
    }
  }
  return out;
}

/**
 * Derive the dominant output media type. "Dominant" means: if there's any
 * Save/Preview node of a given type, that type wins. Video > Audio > Image
 * when multiple are present — most civitai packs with a Save* node are
 * single-media, so this tie-break is rarely exercised.
 */
export function deriveMediaType(io: WorkflowIo): MediaType {
  let hasImage = false;
  let hasAudio = false;
  let hasVideo = false;
  for (const o of io.outputs) {
    if (o.mediaType === 'video') hasVideo = true;
    else if (o.mediaType === 'audio') hasAudio = true;
    else if (o.mediaType === 'image') hasImage = true;
  }
  if (hasVideo) return 'video';
  if (hasAudio) return 'audio';
  if (hasImage) return 'image';
  return 'image';
}

/**
 * Same mapping as `mapCategory` in templates.service.ts — keeps staged
 * imports in the same sidebar bucket as upstream ones.
 */
export function mediaTypeToStudioCategory(mt: MediaType): StudioCategory {
  if (mt === 'video') return 'video';
  if (mt === 'audio') return 'audio';
  return 'image';
}
