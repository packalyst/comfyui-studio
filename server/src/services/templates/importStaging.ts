// In-memory staging store for user workflow imports.
//
// Flow (phase 1):
//   1. Frontend POSTs a .json or .zip to /templates/import/upload.
//   2. `stageFromZip` / `stageFromJson` (companion modules) build a
//      `StagedImport` and hand it to `storeStaging` below.
//   3. Manifest returned to the frontend via `toManifest` (strips buffers).
//   4. User picks workflows + whether to copy reference images.
//   5. `commitStaging` (in `importCommit.ts`) writes templates + images
//      and clears the row.
//
// Staging rows expire after 15 minutes via `setTimeout` — no persistent
// storage, no cron. Abort via `abortStaging(id)`.

import { randomUUID } from 'crypto';
import type { PluginResolution } from './extractDepsAsync.js';

export type ImportSource = 'upload' | 'civitai';
export type MediaType = 'image' | 'video' | 'audio';

export interface StagedWorkflowEntry {
  /** Original path inside the zip (or synthetic for single-JSON uploads). */
  entryName: string;
  /** Preferred display title — derived from the filename or upstream meta. */
  title: string;
  description?: string;
  /** Node count (top-level + nested). Surfaced in the review UI. */
  nodeCount: number;
  /** Model filenames this workflow depends on (extracted by `extractDeps`). */
  models: string[];
  /**
   * Model URLs discovered inside MarkdownNote / Note bodies (HuggingFace +
   * CivitAI hosts only). Wave E surfaces these in the review UI as
   * one-click "Resolve via URL" suggestions when a referenced filename has
   * no catalog match yet.
   */
  modelUrls: string[];
  /**
   * Resolved plugin requirements. Each entry carries either a Manager
   * class_type match (with `matches[]` populated) or zero matches for a
   * class_type the Manager catalog doesn't know about. Phase 1 shipped a
   * flat string[]; the wider shape lets the review step render install
   * checkboxes + "unresolved" warnings without a second round trip.
   */
  plugins: PluginResolution[];
  /** Derived media type used to populate studioCategory on commit. */
  mediaType: MediaType;
  /** Raw bytes of the serialized JSON — kept in memory only. */
  jsonBytes: number;
  /** The workflow document itself. Not surfaced in the manifest. */
  workflow: Record<string, unknown>;
  /**
   * Per-missing-filename overrides populated by the `resolve-model` route.
   * When a user pastes a URL that resolves, the resolver upserts the
   * catalog and stamps the resolution here so the review UI can flip
   * the row's state from "missing" to "resolved".
   */
  resolvedModels?: Record<string, { downloadUrl: string; source: 'huggingface' | 'civitai'; suggestedFolder?: string; sizeBytes?: number }>;
}

export interface StagedImageEntry {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface StagedImport {
  id: string;
  createdAt: number;
  source: ImportSource;
  sourceUrl?: string;
  workflows: StagedWorkflowEntry[];
  images: StagedImageEntry[];
  notes: string[];
  /** Optional metadata hoisted onto every committed workflow (civitai flow). */
  defaultTitle?: string;
  defaultDescription?: string;
  defaultTags?: string[];
  defaultThumbnail?: string;
}

/** Shape returned by the list + get endpoints — no buffers. */
export interface StagedImportManifest {
  id: string;
  createdAt: number;
  source: ImportSource;
  sourceUrl?: string;
  workflows: Array<{
    entryName: string;
    title: string;
    description?: string;
    nodeCount: number;
    models: string[];
    modelUrls: string[];
    plugins: PluginResolution[];
    mediaType: MediaType;
    jsonBytes: number;
    resolvedModels?: Record<string, { downloadUrl: string; source: 'huggingface' | 'civitai'; suggestedFolder?: string; sizeBytes?: number }>;
  }>;
  images: Array<{ name: string; mimeType: string; sizeBytes: number }>;
  notes: string[];
  defaultTitle?: string;
  defaultDescription?: string;
  defaultTags?: string[];
  defaultThumbnail?: string;
}

const STAGING_TTL_MS = 15 * 60_000;

interface StagingRow {
  staged: StagedImport;
  timer: ReturnType<typeof setTimeout>;
}

const staging = new Map<string, StagingRow>();

function scheduleExpire(id: string): ReturnType<typeof setTimeout> {
  const t = setTimeout(() => {
    staging.delete(id);
  }, STAGING_TTL_MS);
  const u = (t as { unref?: () => void }).unref;
  if (typeof u === 'function') u.call(t);
  return t;
}

/** Build an empty shell ready to be populated by a staging helper. */
export function newStagedImport(source: ImportSource, sourceUrl?: string): StagedImport {
  return {
    id: randomUUID(),
    createdAt: Date.now(),
    source,
    sourceUrl,
    workflows: [],
    images: [],
    notes: [],
  };
}

/** Register a staged import + kick off the TTL timer. */
export function storeStaging(staged: StagedImport): StagedImport {
  const timer = scheduleExpire(staged.id);
  staging.set(staged.id, { staged, timer });
  return staged;
}

export function getStaging(id: string): StagedImport | null {
  return staging.get(id)?.staged ?? null;
}

export function abortStaging(id: string): boolean {
  const row = staging.get(id);
  if (!row) return false;
  clearTimeout(row.timer);
  staging.delete(id);
  return true;
}

/** Used by commit — drops the row but lets the caller keep a reference. */
export function consumeStaging(id: string): StagedImport | null {
  const row = staging.get(id);
  if (!row) return null;
  clearTimeout(row.timer);
  staging.delete(id);
  return row.staged;
}

/** Trim internal state into the manifest shape surfaced over the wire. */
export function toManifest(staged: StagedImport): StagedImportManifest {
  return {
    id: staged.id,
    createdAt: staged.createdAt,
    source: staged.source,
    sourceUrl: staged.sourceUrl,
    workflows: staged.workflows.map((w) => ({
      entryName: w.entryName,
      title: w.title,
      description: w.description,
      nodeCount: w.nodeCount,
      models: w.models,
      modelUrls: w.modelUrls ?? [],
      plugins: w.plugins,
      mediaType: w.mediaType,
      jsonBytes: w.jsonBytes,
      resolvedModels: w.resolvedModels,
    })),
    images: staged.images.map((i) => ({
      name: i.name,
      mimeType: i.mimeType,
      sizeBytes: i.bytes.byteLength,
    })),
    notes: staged.notes,
    defaultTitle: staged.defaultTitle,
    defaultDescription: staged.defaultDescription,
    defaultTags: staged.defaultTags,
    defaultThumbnail: staged.defaultThumbnail,
  };
}

export const IMPORT_LIMITS = {
  MAX_ZIP_ENTRIES: 500,
  MAX_ZIP_BYTES: 20 * 1024 * 1024,
} as const;

/** Shared check — reject `..` / absolute / nul-byte entry names. */
export function entryNameIsSafe(name: string): boolean {
  if (!name || name.includes('\0')) return false;
  if (name.startsWith('/') || name.startsWith('\\')) return false;
  if (name.includes('..')) return false;
  return true;
}

/** LiteGraph shape guard, shared by the civitai import + the staging walker. */
export function looksLikeLitegraph(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false;
  const nodes = (value as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return false;
  return nodes.length === 0 || (typeof nodes[0] === 'object' && nodes[0] !== null);
}
