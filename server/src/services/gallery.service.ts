// Gallery service. Thin layer that glues the sqlite repo to the ComfyUI
// scanner. Routes + the WS broadcast path talk to this module — nothing
// downstream imports the repo directly except the DB tests.
//
// Seeding: first call scans ComfyUI's history and bulk-upserts every row.
// Subsequent generation-complete events re-run the scanner and upsert
// again; `INSERT OR REPLACE` keeps the table idempotent.
//
// Row `createdAt` is synthesised: upstream history has no per-output
// timestamp, so we use `Date.now() - index` for a newly-scanned batch so
// newest-first ordering is preserved. Anything already in the table
// keeps its original createdAt because INSERT OR REPLACE re-uses the
// primary key but the repo's insert stamp is "now" for freshly-produced
// items (scheduled on `execution_complete`).

import { getGalleryItems } from './comfyui.js';
import type { GalleryItem } from '../contracts/generation.contract.js';
import * as repo from '../lib/db/gallery.repo.js';
import { logger } from '../lib/logger.js';

let seedInFlight: Promise<void> | null = null;

function itemToRow(item: GalleryItem, createdAt: number): repo.GalleryRow {
  return { ...item, createdAt };
}

/**
 * Pull the full history from ComfyUI and upsert into sqlite. Called on
 * first access (when the table is empty) and on `execution_complete`.
 * Failures are logged + swallowed so the gallery route stays fail-open.
 */
export async function syncFromComfyUI(): Promise<number> {
  try {
    const items = await getGalleryItems();
    const now = Date.now();
    const rows = items.map((it, idx) => itemToRow(it, now - idx));
    return repo.rebuildFromScan(rows);
  } catch (err) {
    logger.warn('gallery sync failed', { message: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}

/**
 * Ensure the gallery table has been seeded at least once this process-
 * lifetime. Idempotent across concurrent callers thanks to the in-flight
 * promise latch.
 */
export async function ensureSeeded(): Promise<void> {
  if (repo.count() > 0) return;
  if (seedInFlight) return seedInFlight;
  seedInFlight = (async () => { await syncFromComfyUI(); })();
  try { await seedInFlight; } finally { seedInFlight = null; }
}

export interface ListFilter {
  mediaType?: string;
  sort?: 'newest' | 'oldest';
}

/** Full list (non-paginated). Used when the route gets no ?page= param. */
export async function list(): Promise<GalleryItem[]> {
  await ensureSeeded();
  return repo.listAll({ sort: 'newest' });
}

/** Paginated list. Filters applied at SQL level. */
export async function listPaginated(
  filter: ListFilter,
  page: number,
  pageSize: number,
): Promise<{ items: GalleryItem[]; total: number }> {
  await ensureSeeded();
  return repo.listPaginated(
    { mediaType: filter.mediaType, sort: filter.sort === 'oldest' ? 'oldest' : 'newest' },
    page,
    pageSize,
  );
}

/**
 * Mark a new item as generated. Invoked from the WS broadcast loop when
 * ComfyUI emits `execution_complete`. We don't know the individual output
 * filenames ahead of time so we re-run the scanner and upsert everything
 * — same path as first-boot seed.
 */
export async function onGenerationComplete(): Promise<void> {
  await syncFromComfyUI();
}

/** Remove a row by id (used by future delete endpoints). */
export function remove(id: string): boolean { return repo.remove(id); }
