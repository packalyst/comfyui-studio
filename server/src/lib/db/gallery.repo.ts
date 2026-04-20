// Gallery repository. Backs `GET /gallery` and the generation-complete hook.
//
// Rows are keyed on `<promptId>-<filename>` to match the existing id scheme
// from `getGalleryItems()` — this keeps bulk seeding idempotent (the same
// history row re-scanned twice doesn't duplicate) and lets the broadcast
// loop call `upsertMany` without tracking what's new.
//
// Every query is a prepared statement; parameters are positional so the
// driver escapes them — never string-concatenate into SQL here.

import type Database from 'better-sqlite3';
import type { GalleryItem } from '../../contracts/generation.contract.js';
import { getDb } from './connection.js';

export interface GalleryRow extends GalleryItem {
  createdAt: number;
  templateName?: string;
  sizeBytes?: number;
}

export interface GalleryListFilter {
  mediaType?: string;           // 'all' or '' = no filter
  sort?: 'newest' | 'oldest';   // default newest
}

function rowToItem(r: Record<string, unknown>): GalleryItem {
  return {
    id: String(r.id),
    filename: String(r.filename),
    subfolder: String(r.subfolder ?? ''),
    type: String(r.type ?? 'output'),
    mediaType: String(r.mediaType),
    url: String(r.url ?? ''),
    promptId: String(r.promptId ?? ''),
  };
}

export function insert(item: GalleryRow, db: Database.Database = getDb()): void {
  db.prepare(`
    INSERT OR REPLACE INTO gallery
      (id, filename, subfolder, mediaType, createdAt, templateName,
       promptId, sizeBytes, url, type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.id, item.filename, item.subfolder ?? '', item.mediaType,
    item.createdAt, item.templateName ?? null, item.promptId ?? null,
    item.sizeBytes ?? null, item.url ?? '', item.type ?? 'output',
  );
}

export function remove(id: string, db: Database.Database = getDb()): boolean {
  const r = db.prepare('DELETE FROM gallery WHERE id = ?').run(id);
  return r.changes > 0;
}

export function getById(id: string, db: Database.Database = getDb()): GalleryItem | null {
  const r = db.prepare('SELECT * FROM gallery WHERE id = ?').get(id) as
    | Record<string, unknown> | undefined;
  return r ? rowToItem(r) : null;
}

export function count(db: Database.Database = getDb()): number {
  const r = db.prepare('SELECT COUNT(*) as c FROM gallery').get() as { c: number };
  return r.c;
}

export function listAll(
  filter: GalleryListFilter = {},
  db: Database.Database = getDb(),
): GalleryItem[] {
  const { mediaType, sort } = filter;
  const dir = sort === 'oldest' ? 'ASC' : 'DESC';
  const where = mediaType && mediaType !== 'all' ? 'WHERE mediaType = ?' : '';
  const params = mediaType && mediaType !== 'all' ? [mediaType] : [];
  const sql = `SELECT * FROM gallery ${where} ORDER BY createdAt ${dir}, id ${dir}`;
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToItem);
}

export interface PageResult {
  items: GalleryItem[];
  total: number;
}

export function listPaginated(
  filter: GalleryListFilter,
  page: number,
  pageSize: number,
  db: Database.Database = getDb(),
): PageResult {
  const { mediaType, sort } = filter;
  const dir = sort === 'oldest' ? 'ASC' : 'DESC';
  const useFilter = !!(mediaType && mediaType !== 'all');
  const where = useFilter ? 'WHERE mediaType = ?' : '';
  const cParams = useFilter ? [mediaType] : [];
  const total = (db.prepare(`SELECT COUNT(*) as c FROM gallery ${where}`)
    .get(...cParams) as { c: number }).c;
  const offset = Math.max(0, (page - 1) * pageSize);
  const sql = `SELECT * FROM gallery ${where} ORDER BY createdAt ${dir}, id ${dir} LIMIT ? OFFSET ?`;
  const params = useFilter ? [mediaType, pageSize, offset] : [pageSize, offset];
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return { items: rows.map(rowToItem), total };
}

/**
 * Bulk upsert in a single transaction. Used on first-boot seed (empty DB
 * scan) and on every generation-complete broadcast to keep sqlite in sync
 * with ComfyUI's history without per-row round-trips.
 */
export function rebuildFromScan(
  items: GalleryRow[],
  db: Database.Database = getDb(),
): number {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO gallery
      (id, filename, subfolder, mediaType, createdAt, templateName,
       promptId, sizeBytes, url, type)
    VALUES (@id, @filename, @subfolder, @mediaType, @createdAt, @templateName,
            @promptId, @sizeBytes, @url, @type)
  `);
  const tx = db.transaction((rows: GalleryRow[]) => {
    for (const row of rows) {
      stmt.run({
        id: row.id,
        filename: row.filename,
        subfolder: row.subfolder ?? '',
        mediaType: row.mediaType,
        createdAt: row.createdAt,
        templateName: row.templateName ?? null,
        promptId: row.promptId ?? null,
        sizeBytes: row.sizeBytes ?? null,
        url: row.url ?? '',
        type: row.type ?? 'output',
      });
    }
  });
  tx(items);
  return items.length;
}
