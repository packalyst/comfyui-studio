// Pure dep extraction from a template's workflow document.
//
// Used by two callers:
//   1. `dependencies.routes.ts /check-dependencies` — list missing models.
//   2. `templates.service.ts` boot-time loader + `/templates/refresh` — cache
//      each template's required models + plugins into sqlite.
//
// Model extraction reproduces the original logic from the check-dependencies
// handler 1:1 (node-level `properties.models[]` + loader-node widget_values
// filename scan through `collectAllWorkflowNodes` so nested subgraph loaders
// aren't missed).
//
// Plugin extraction is best-effort: ComfyUI Manager stamps each custom node
// with `properties.aux_id` (usually the plugin's github "owner/repo"
// identifier) and sometimes `properties.cnr_id`. We collect both, dedup, and
// leave resolution to the catalog layer.

import { collectAllWorkflowNodes } from '../workflow/collect.js';
import { LOADER_TYPES } from '../workflow/constants.js';
import type { WorkflowNode } from '../../contracts/workflow.contract.js';

export interface ExtractedDeps {
  models: string[];
  plugins: string[];
}

const MODEL_FILE_EXT = /\.(safetensors|pth|ckpt|pt|bin)$/i;

function readStringProp(node: WorkflowNode, key: string): string | undefined {
  const props = (node as { properties?: unknown }).properties;
  if (!props || typeof props !== 'object') return undefined;
  const val = (props as Record<string, unknown>)[key];
  return typeof val === 'string' && val.length > 0 ? val : undefined;
}

function collectNodeTemplateModels(node: WorkflowNode, out: Set<string>): void {
  const props = (node as { properties?: unknown }).properties;
  if (!props || typeof props !== 'object') return;
  const arr = (props as { models?: unknown }).models;
  if (!Array.isArray(arr)) return;
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const name = (raw as { name?: unknown }).name;
    if (typeof name === 'string' && name.length > 0) out.add(name);
  }
}

function collectLoaderFilenames(node: WorkflowNode, out: Set<string>): void {
  const nodeType = (node.type as string | undefined)
    || (node.class_type as string | undefined)
    || '';
  if (!LOADER_TYPES.has(nodeType)) return;
  if (!Array.isArray(node.widgets_values)) return;
  for (const val of node.widgets_values) {
    if (typeof val !== 'string') continue;
    if (!MODEL_FILE_EXT.test(val)) continue;
    out.add(val);
  }
}

function collectNodePlugin(node: WorkflowNode, out: Set<string>): void {
  const aux = readStringProp(node, 'aux_id');
  if (aux) out.add(normalizePluginId(aux));
  const cnr = readStringProp(node, 'cnr_id');
  if (cnr) out.add(normalizePluginId(cnr));
}

function normalizePluginId(raw: string): string {
  return raw.trim().toLowerCase()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
}

/**
 * Given a workflow document (LiteGraph or raw API-prompt), return the set of
 * model filenames and plugin ids that the workflow references.
 *
 * Pure function: no catalog reads, no disk I/O, no network.
 */
export function extractDeps(workflow: unknown): ExtractedDeps {
  const models = new Set<string>();
  const plugins = new Set<string>();
  if (!workflow || typeof workflow !== 'object') {
    return { models: [], plugins: [] };
  }
  const nodes = collectAllWorkflowNodes(workflow as Record<string, unknown>);
  for (const node of nodes) {
    collectNodeTemplateModels(node, models);
    collectLoaderFilenames(node, models);
    collectNodePlugin(node, plugins);
  }
  return {
    models: Array.from(models).sort(),
    plugins: Array.from(plugins).sort(),
  };
}
