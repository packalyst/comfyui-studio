// Gallery metadata extractor.
//
// ComfyUI's `/api/history/:promptId` entry carries the API-format workflow
// that produced the outputs under `entry.prompt`. That's a record of node
// ids → `{ class_type, inputs: { ... } }`. Wave F captures the KSampler
// parameters, positive/negative prompts, model, and latent dimensions into
// the gallery row so the UI can show them and the Regenerate button can
// re-submit a slightly-mutated copy.
//
// The extractor is deliberately defensive — any of these nodes may be
// absent (plain img-to-img without a sampler, audio workflows without a
// checkpoint loader, etc.). Every returned field is nullable.
//
// Heuristics:
//  - positive / negative CLIPTextEncode: follow the KSampler node's
//    `positive`/`negative` input array (`[nodeId, outputIndex]`) back to
//    the text-encoder node. If the sampler is missing we pick whichever
//    CLIPTextEncode has the longest text as the positive prompt.
//  - seed: prefer `seed` (KSampler) then `noise_seed` (KSamplerAdvanced).
//  - model: `CheckpointLoaderSimple.ckpt_name` first, then `UNETLoader.unet_name`.
//  - width/height: first node of the known latent image types.

export interface ApiPromptNode {
  class_type?: string;
  inputs?: Record<string, unknown>;
}

export type ApiPrompt = Record<string, ApiPromptNode>;

export interface ExtractedMetadata {
  promptText: string | null;
  negativeText: string | null;
  seed: number | null;
  model: string | null;
  sampler: string | null;
  steps: number | null;
  cfg: number | null;
  width: number | null;
  height: number | null;
}

const KSAMPLER_TYPES = new Set(['KSampler', 'KSamplerAdvanced']);
const LATENT_TYPES = new Set([
  'EmptyLatentImage', 'EmptySD3LatentImage', 'EmptyHunyuanLatentVideo',
  'EmptyLTXVLatentVideo', 'EmptyLatentAudio',
]);
const CHECKPOINT_TYPES = new Set(['CheckpointLoaderSimple', 'CheckpointLoader']);
const UNET_TYPES = new Set(['UNETLoader', 'UNetLoader']);

function coerceString(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return null;
}

function coerceNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/**
 * Return the node id referenced by `linkValue`, which in ComfyUI's API
 * format is `[nodeId, outputIndex]`. Tolerant of string/number ids and
 * shape weirdness — returns null when it can't parse.
 */
function linkTargetId(linkValue: unknown): string | null {
  if (!Array.isArray(linkValue) || linkValue.length === 0) return null;
  const head = linkValue[0];
  if (typeof head === 'string') return head;
  if (typeof head === 'number' && Number.isFinite(head)) return String(head);
  return null;
}

/** Walk the prompt for every node matching any of the provided class types. */
function findNodesByClass(prompt: ApiPrompt, classes: Set<string>): Array<[string, ApiPromptNode]> {
  const out: Array<[string, ApiPromptNode]> = [];
  for (const [id, node] of Object.entries(prompt)) {
    if (node?.class_type && classes.has(node.class_type)) out.push([id, node]);
  }
  return out;
}

function pickKSampler(prompt: ApiPrompt): ApiPromptNode | null {
  const hits = findNodesByClass(prompt, KSAMPLER_TYPES);
  return hits[0]?.[1] ?? null;
}

/**
 * Resolve a CLIPTextEncode node id to its text. When the id is missing or
 * the target isn't a CLIPTextEncode we return null and let the fallback
 * pick the longest text-encoder across the prompt.
 */
function resolveTextEncode(prompt: ApiPrompt, nodeId: string | null): string | null {
  if (!nodeId) return null;
  const n = prompt[nodeId];
  if (!n || n.class_type !== 'CLIPTextEncode') return null;
  return coerceString(n.inputs?.text);
}

/**
 * Fallback path when no KSampler is present: return the longest
 * CLIPTextEncode text on the prompt as the positive prompt. We treat
 * "longest" as a weak proxy for "the one the user typed their prompt in"
 * — shared triggers/styling nodes tend to be short.
 */
function pickLongestTextEncode(prompt: ApiPrompt): string | null {
  let best: string | null = null;
  for (const [, node] of Object.entries(prompt)) {
    if (node?.class_type !== 'CLIPTextEncode') continue;
    const t = coerceString(node.inputs?.text);
    if (!t) continue;
    if (best === null || t.length > best.length) best = t;
  }
  return best;
}

/** Scan all nodes for the first width/height pair under a known latent type. */
function extractLatentDimensions(prompt: ApiPrompt): { width: number | null; height: number | null } {
  for (const [, node] of Object.entries(prompt)) {
    if (!node?.class_type || !LATENT_TYPES.has(node.class_type)) continue;
    const w = coerceNumber(node.inputs?.width);
    const h = coerceNumber(node.inputs?.height);
    if (w !== null || h !== null) return { width: w, height: h };
  }
  return { width: null, height: null };
}

function extractModel(prompt: ApiPrompt): string | null {
  for (const [, node] of Object.entries(prompt)) {
    if (node?.class_type && CHECKPOINT_TYPES.has(node.class_type)) {
      const n = coerceString(node.inputs?.ckpt_name);
      if (n) return n;
    }
  }
  for (const [, node] of Object.entries(prompt)) {
    if (node?.class_type && UNET_TYPES.has(node.class_type)) {
      const n = coerceString(node.inputs?.unet_name);
      if (n) return n;
    }
  }
  return null;
}

/**
 * Extract the Wave F metadata fields from an API-format workflow. `prompt`
 * is the value under `entry.prompt` returned by `/api/history/:promptId`.
 * Returns every field nullable — callers must tolerate partial data.
 */
export function extractMetadata(prompt: ApiPrompt | null | undefined): ExtractedMetadata {
  const base: ExtractedMetadata = {
    promptText: null, negativeText: null, seed: null, model: null,
    sampler: null, steps: null, cfg: null, width: null, height: null,
  };
  if (!prompt || typeof prompt !== 'object') return base;

  const ks = pickKSampler(prompt);
  if (ks) {
    const positiveId = linkTargetId(ks.inputs?.positive);
    const negativeId = linkTargetId(ks.inputs?.negative);
    base.promptText = resolveTextEncode(prompt, positiveId);
    base.negativeText = resolveTextEncode(prompt, negativeId) ?? '';
    // Seed: KSampler uses `seed`; KSamplerAdvanced uses `noise_seed`.
    base.seed = coerceNumber(ks.inputs?.seed)
      ?? coerceNumber(ks.inputs?.noise_seed);
    base.sampler = coerceString(ks.inputs?.sampler_name);
    base.steps = coerceNumber(ks.inputs?.steps);
    base.cfg = coerceNumber(ks.inputs?.cfg);
  }

  // Fallback when the sampler isn't present OR its positive wire didn't
  // resolve to a CLIPTextEncode node.
  if (!base.promptText) base.promptText = pickLongestTextEncode(prompt);

  base.model = extractModel(prompt);
  const dims = extractLatentDimensions(prompt);
  base.width = dims.width;
  base.height = dims.height;

  return base;
}

/**
 * Walk the prompt in-place and replace `seed`/`noise_seed` on every
 * KSampler variant with a new random int. Used by the regenerate endpoint
 * when the caller opts into seed randomisation. Mutates the input.
 */
export function randomizeSeeds(prompt: ApiPrompt): void {
  for (const [, node] of Object.entries(prompt)) {
    if (!node?.class_type || !KSAMPLER_TYPES.has(node.class_type)) continue;
    if (!node.inputs) continue;
    const next = Math.floor(Math.random() * 0xffffffff);
    if ('seed' in node.inputs) node.inputs.seed = next;
    if ('noise_seed' in node.inputs) node.inputs.noise_seed = next;
  }
}
