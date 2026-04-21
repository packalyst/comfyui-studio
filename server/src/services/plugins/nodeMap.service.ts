// Authoritative class_type -> plugin resolver.
//
// Source of truth is ComfyUI-Manager's `GET /customnode/getmappings?mode=cache`
// endpoint, which returns the contents of `extension-node-map.json` keyed by
// repository URL. The response shape (verified against `custom-templates-plan.md`
// §1 "ComfyUI-Manager endpoints") is:
//
//   {
//     "<repo_url>": [
//       ["NodeClassA", "NodeClassB", ...],   // node class_types registered by the plugin
//       { "title_aux": "<display title>", "cnr_id"?: "<manager id>" }
//     ],
//     ...
//   }
//
// We invert this map once per hour (a `class_type -> [{repo, title, cnr_id}]`
// lookup) so `extractDeps*` can resolve raw LiteGraph nodes that have no
// `aux_id`/`cnr_id` stamped on them. A single class_type can appear in
// multiple plugin repos (forks, re-exports) — we preserve every match so the
// UI can surface the ambiguity instead of silently picking one.
//
// Degrade rule: when the Manager endpoint is unreachable we log once and
// return every class_type as `{matches: []}` — the caller renders an
// "unresolved" badge and the import still succeeds.

import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export interface PluginMapMatch {
  /** Canonical repo URL as returned by Manager (e.g. https://github.com/x/y). */
  repo: string;
  /** Display title, drawn from Manager's `title_aux`. Falls back to repo. */
  title: string;
  /** Manager registry id when present (lets us reuse plugin catalog rows). */
  cnr_id?: string;
}

export interface PluginResolution {
  classType: string;
  matches: PluginMapMatch[];
}

type ManagerMappings = Record<string, unknown>;

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024; // 8 MiB safety cap

interface CacheState {
  /** Inverted index: class_type (lowercased) -> list of plugin matches. */
  index: Map<string, PluginMapMatch[]>;
  /** Last successful build time (ms since epoch). */
  fetchedAt: number;
}

let state: CacheState | null = null;
let inflight: Promise<CacheState | null> | null = null;
let degradedLogged = false;

function normalizeRepo(url: string): string {
  return url.trim()
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
}

/**
 * Parse a single entry from the Manager response. Returns null when the
 * entry shape doesn't match the documented `[[string, ...], { title_aux, ... }]`
 * pair — we never throw on malformed rows, only skip them.
 */
function parseEntry(repo: string, raw: unknown): {
  classTypes: string[]; match: PluginMapMatch;
} | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const [classes, meta] = raw;
  if (!Array.isArray(classes)) return null;
  const classTypes: string[] = [];
  for (const c of classes) {
    if (typeof c === 'string' && c.length > 0) classTypes.push(c);
  }
  if (classTypes.length === 0) return null;
  let title = '';
  let cnr: string | undefined;
  if (meta && typeof meta === 'object') {
    const m = meta as Record<string, unknown>;
    if (typeof m.title_aux === 'string') title = m.title_aux;
    if (typeof m.cnr_id === 'string' && m.cnr_id.length > 0) cnr = m.cnr_id;
  }
  const repoClean = normalizeRepo(repo);
  return {
    classTypes,
    match: {
      repo: repoClean,
      title: title.length > 0 ? title : repoClean,
      cnr_id: cnr,
    },
  };
}

function buildIndex(data: ManagerMappings): Map<string, PluginMapMatch[]> {
  const idx = new Map<string, PluginMapMatch[]>();
  for (const [repo, raw] of Object.entries(data)) {
    const parsed = parseEntry(repo, raw);
    if (!parsed) continue;
    for (const cls of parsed.classTypes) {
      const key = cls.toLowerCase();
      const bucket = idx.get(key);
      if (bucket) {
        // Dedup by repo — some forks list the same class under the same URL
        // via different capitalizations.
        if (!bucket.some((m) => m.repo === parsed.match.repo)) {
          bucket.push(parsed.match);
        }
      } else {
        idx.set(key, [parsed.match]);
      }
    }
  }
  return idx;
}

async function fetchMappings(): Promise<ManagerMappings | null> {
  try {
    const url = `${env.COMFYUI_URL}/customnode/getmappings?mode=cache`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const contentLength = Number(res.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new Error(`response too large (${contentLength} bytes)`);
    }
    const body = await res.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('unexpected response shape');
    }
    return body as ManagerMappings;
  } catch (err) {
    if (!degradedLogged) {
      degradedLogged = true;
      logger.warn('nodeMap: Manager /customnode/getmappings unreachable; resolver degraded', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return null;
  }
}

async function ensureFresh(): Promise<CacheState | null> {
  const now = Date.now();
  if (state && now - state.fetchedAt < CACHE_TTL_MS) return state;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const data = await fetchMappings();
      if (!data) return null;
      const index = buildIndex(data);
      state = { index, fetchedAt: Date.now() };
      // Reset the degraded-logged latch on every successful refresh.
      degradedLogged = false;
      logger.info('nodeMap: refreshed class_type -> plugin index', {
        classTypes: index.size,
      });
      return state;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/**
 * Resolve a list of workflow class_types to their owning plugin repos via
 * Manager's authoritative index. Class types with zero matches are returned
 * with `matches: []` so the caller can render an "unresolved" badge.
 */
export async function resolveNodeTypes(
  classTypes: string[],
): Promise<PluginResolution[]> {
  const uniq = new Set<string>();
  for (const raw of classTypes) {
    if (typeof raw === 'string' && raw.length > 0) uniq.add(raw);
  }
  const out: PluginResolution[] = [];
  const cache = await ensureFresh();
  const idx = cache?.index;
  for (const cls of uniq) {
    const matches = idx?.get(cls.toLowerCase());
    out.push({
      classType: cls,
      matches: matches ? matches.map((m) => ({ ...m })) : [],
    });
  }
  return out;
}

/**
 * Force a cache rebuild. Used by tests and by a future
 * "Refresh Manager catalog" button in the UI.
 */
export function invalidate(): void {
  state = null;
  inflight = null;
  degradedLogged = false;
}

/**
 * Test-only seed: inject a mappings object directly, skipping the HTTP
 * fetch. Lets unit tests assert the inverted-index build + resolution logic
 * without any network mocking plumbing.
 */
export function _seedForTests(data: ManagerMappings): void {
  state = { index: buildIndex(data), fetchedAt: Date.now() };
}
