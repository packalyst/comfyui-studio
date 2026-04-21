// Rewrite LoadImage / PreviewImage / SaveImage filenames after reference
// images were copied into ComfyUI/input/ under a `<slug>__<name>` prefix.
//
// Used at commit time: the staging pipeline copies each reference image to
// the slug-prefixed filename (so two imports with the same `preview.png`
// don't collide in ComfyUI/input/). The workflow JSON, however, still
// points at the original filename — if we ship that to ComfyUI as-is the
// LoadImage node errors with "File not found". This module walks the
// workflow and rewrites every filename that appears in the provided
// mapping. Returns a deep clone — callers can hand the mutated copy to
// `saveUserWorkflow` without mutating the staging row in memory.

const TARGET_CLASSES = new Set(['LoadImage', 'PreviewImage', 'SaveImage']);

function matches(node: Record<string, unknown>): boolean {
  const kind = typeof node.class_type === 'string'
    ? node.class_type
    : typeof node.type === 'string' ? node.type : '';
  return TARGET_CLASSES.has(kind);
}

function rewriteWidgetValues(
  values: unknown[],
  mapping: Record<string, string>,
): unknown[] {
  return values.map((v) => (typeof v === 'string' && v in mapping ? mapping[v] : v));
}

function rewriteInputs(
  inputs: Record<string, unknown>,
  mapping: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inputs)) {
    out[k] = typeof v === 'string' && v in mapping ? mapping[v] : v;
  }
  return out;
}

function rewriteNode(
  node: Record<string, unknown>,
  mapping: Record<string, string>,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...node };
  if (matches(node)) {
    if (Array.isArray(node.widgets_values)) {
      next.widgets_values = rewriteWidgetValues(node.widgets_values, mapping);
    }
    if (node.inputs && typeof node.inputs === 'object' && !Array.isArray(node.inputs)) {
      next.inputs = rewriteInputs(node.inputs as Record<string, unknown>, mapping);
    }
  }
  // Recurse into subgraph nodes so nested LoadImage instances are rewritten.
  const sub = (node as { subgraph?: unknown }).subgraph;
  if (sub && typeof sub === 'object') {
    const subNodes = (sub as { nodes?: unknown }).nodes;
    if (Array.isArray(subNodes)) {
      next.subgraph = {
        ...(sub as object),
        nodes: subNodes.map((n) =>
          n && typeof n === 'object' ? rewriteNode(n as Record<string, unknown>, mapping) : n,
        ),
      };
    }
  }
  return next;
}

/**
 * Walk a workflow JSON and rewrite any LoadImage / PreviewImage / SaveImage
 * filename that appears in `mapping`. Returns a deep clone of the workflow;
 * the input is never mutated. Empty mappings short-circuit to a clone so
 * callers don't need to special-case "no renames".
 */
export function rewriteLoadImageReferences(
  workflowJson: unknown,
  mapping: Record<string, string>,
): unknown {
  if (!workflowJson || typeof workflowJson !== 'object') return workflowJson;
  // Cheap + correct: JSON clone. The object shape is already JSON-safe
  // because it came from `JSON.parse` at import time.
  const cloned = JSON.parse(JSON.stringify(workflowJson)) as Record<string, unknown>;
  if (!mapping || Object.keys(mapping).length === 0) return cloned;

  // API format: dict keyed by node id, each carrying class_type + inputs.
  for (const key of Object.keys(cloned)) {
    const entry = cloned[key];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    if ('class_type' in (entry as Record<string, unknown>)) {
      cloned[key] = rewriteNode(entry as Record<string, unknown>, mapping);
    }
  }

  // UI/LiteGraph format.
  if (Array.isArray(cloned.nodes)) {
    cloned.nodes = cloned.nodes.map((n) =>
      n && typeof n === 'object' ? rewriteNode(n as Record<string, unknown>, mapping) : n,
    );
  }

  const defs = cloned.definitions;
  if (defs && typeof defs === 'object') {
    const subgraphs = (defs as { subgraphs?: unknown }).subgraphs;
    if (Array.isArray(subgraphs)) {
      const nextSubs = subgraphs.map((sg) => {
        if (!sg || typeof sg !== 'object') return sg;
        const nodes = (sg as { nodes?: unknown }).nodes;
        if (!Array.isArray(nodes)) return sg;
        return {
          ...(sg as object),
          nodes: nodes.map((n) =>
            n && typeof n === 'object' ? rewriteNode(n as Record<string, unknown>, mapping) : n,
          ),
        };
      });
      cloned.definitions = { ...(defs as object), subgraphs: nextSubs };
    }
  }

  return cloned;
}
