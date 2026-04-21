// HuggingFace model URL resolver.
//
// Used by Wave E's manual "Resolve via URL" affordance on the import review
// step. Takes a public HuggingFace URL, normalises `/blob/` -> `/resolve/`
// for direct download, HEADs the result to learn the byte size, and infers
// the ComfyUI models folder the file belongs in (checkpoints, loras, ...).
//
// Deliberately narrow: the resolver only understands file URLs. Repo-root
// URLs return null because there is no reliable way to pick a single file
// out of a multi-file repo automatically — that ambiguity is surfaced to
// the user who can then paste the specific /blob/ link.

import { env } from '../../config/env.js';

export type SuggestedFolder =
  | 'checkpoints'
  | 'loras'
  | 'vae'
  | 'clip'
  | 'controlnet'
  | 'upscale_models'
  | 'unet'
  | 'embeddings';

export interface ResolvedModel {
  source: 'huggingface' | 'civitai';
  /** Direct HTTPS URL the launcher can stream into models/. */
  downloadUrl: string;
  fileName: string;
  sizeBytes?: number;
  suggestedFolder?: SuggestedFolder;
  /** HuggingFace `<org>/<repo>` identifier. Present on HF results. */
  repoId?: string;
  /** Git ref (branch, tag, commit). Present on HF results. */
  revision?: string;
  /** CivitAI-only metadata. */
  civitai?: {
    modelId: number;
    versionId: number;
    modelType?: string;
    baseModel?: string;
  };
}

const MODEL_FILE_EXT_RE = /\.(safetensors|pth|pt|bin|ckpt|gguf)$/i;

/**
 * Path-segment + extension based placement heuristic. Keeps things obvious:
 * if the HF repo path contains `/loras/` we trust it, otherwise fall back to
 * filename hints, otherwise fall back to `checkpoints` for any known weight
 * extension. Returns `undefined` when nothing matches so the caller can
 * display "unknown — please set save_path manually".
 */
export function guessFolder(pathInRepo: string, fileName: string): SuggestedFolder | undefined {
  // Normalise path with leading + trailing slashes so the per-segment regexes
  // work whether the caller passed a rooted path ("/foo/bar") or a relative
  // one ("foo/bar"). This also lets us treat the first segment uniformly.
  const lowerPath = `/${pathInRepo.toLowerCase().replace(/^\/+/, '')}/`;
  const lowerName = fileName.toLowerCase();
  if (/\/loras?\//.test(lowerPath) || /(^|[_-])lora([_-]|\.)/.test(lowerName)) return 'loras';
  if (/\/vae\//.test(lowerPath) || /(^|[_-])vae([_-]|\.)/.test(lowerName)) return 'vae';
  if (/\/controlnet\//.test(lowerPath) || /controlnet/.test(lowerName)) return 'controlnet';
  if (/\/clip\//.test(lowerPath) || /(^|[_-])clip([_-]|\.)/.test(lowerName)) return 'clip';
  if (/\/upscale/.test(lowerPath) || /upscal(er|e)/.test(lowerName)) return 'upscale_models';
  if (/\/unet\//.test(lowerPath) || /(^|[_-])unet([_-]|\.)/.test(lowerName)) return 'unet';
  if (/\/embeddings?\//.test(lowerPath) || /\/textual_inversion\//.test(lowerPath)) return 'embeddings';
  if (MODEL_FILE_EXT_RE.test(lowerName)) return 'checkpoints';
  return undefined;
}

interface ParsedHfFile {
  repoId: string;
  revision: string;
  pathInRepo: string;
}

/**
 * Accepts the two shapes HF exposes publicly:
 *   - https://huggingface.co/<org>/<repo>/blob/<ref>/<path>
 *   - https://huggingface.co/<org>/<repo>/resolve/<ref>/<path>
 * Repo-root URLs (no /blob/ or /resolve/) return null.
 */
function parseHfFileUrl(raw: string): ParsedHfFile | null {
  let u: URL;
  try { u = new URL(raw); }
  catch { return null; }
  const host = u.hostname.toLowerCase();
  if (host !== 'huggingface.co' && host !== 'www.huggingface.co') return null;
  const parts = u.pathname.split('/').filter((p) => p.length > 0);
  if (parts.length < 5) return null;
  const [org, repo, kind, ref, ...rest] = parts;
  if (kind !== 'blob' && kind !== 'resolve') return null;
  if (rest.length === 0) return null;
  return {
    repoId: `${org}/${repo}`,
    revision: ref,
    pathInRepo: rest.join('/'),
  };
}

function buildResolveUrl(repoId: string, revision: string, pathInRepo: string): string {
  const encodedPath = pathInRepo.split('/').map(encodeURIComponent).join('/');
  return `https://huggingface.co/${repoId}/resolve/${encodeURIComponent(revision)}/${encodedPath}`;
}

function hfAuthHeaders(): Record<string, string> {
  const token = env.HUGGINGFACE_TOKEN;
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function headSize(url: string): Promise<number | undefined> {
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      headers: hfAuthHeaders(),
      redirect: 'follow',
    });
    if (!res.ok) return undefined;
    const linked = res.headers.get('x-linked-size');
    const contentLength = res.headers.get('content-length');
    const bytes = linked ? Number(linked) : contentLength ? Number(contentLength) : NaN;
    return Number.isFinite(bytes) && bytes > 0 ? bytes : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve a HuggingFace URL into a `ResolvedModel`. Returns null (not
 * throws) for malformed URLs or repo-root links we cannot disambiguate.
 * HEAD failures degrade gracefully: the result still ships with
 * `sizeBytes: undefined` so the caller can prompt the user to retry later.
 */
export async function resolveHuggingfaceUrl(url: string): Promise<ResolvedModel | null> {
  if (typeof url !== 'string' || url.length === 0) return null;
  const parsed = parseHfFileUrl(url);
  if (!parsed) return null;
  const downloadUrl = buildResolveUrl(parsed.repoId, parsed.revision, parsed.pathInRepo);
  const fileName = parsed.pathInRepo.split('/').pop() || parsed.pathInRepo;
  const suggestedFolder = guessFolder(parsed.pathInRepo, fileName);
  const sizeBytes = await headSize(downloadUrl);
  const resolved: ResolvedModel = {
    source: 'huggingface',
    downloadUrl,
    fileName,
    repoId: parsed.repoId,
    revision: parsed.revision,
  };
  if (typeof sizeBytes === 'number') resolved.sizeBytes = sizeBytes;
  if (suggestedFolder) resolved.suggestedFolder = suggestedFolder;
  return resolved;
}
