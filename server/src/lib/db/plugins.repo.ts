// Plugins-catalog repository. Rows mirror entries from
// `all_nodes.mirrored.json`; the raw JSON is preserved verbatim in
// `raw_json` so consumers can reconstruct the original shape without the
// repo hardcoding every upstream field.
//
// `search` is a LIKE query on title / description / id / author. ComfyUI
// Manager's catalog is ~3k rows so unindexed substring search is fast
// enough. If we ever need true full-text we can add an FTS5 vtable.

import type Database from 'better-sqlite3';
import { getDb } from './connection.js';

export interface PluginCatalogRow {
  id: string;
  title: string;
  author?: string;
  description?: string;
  reference: string;
  install_type?: string;
  trust_level?: string;
  raw: Record<string, unknown>;
}

export interface PluginListFilter {
  q?: string;                            // substring, case-insensitive
  filter?: 'all' | 'installed' | 'available';
  installedIds?: Set<string>;            // ids currently installed on disk
}

function rowToEntry(r: Record<string, unknown>): PluginCatalogRow {
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(String(r.raw_json ?? '{}')); } catch { /* keep empty */ }
  return {
    id: String(r.id),
    title: String(r.title ?? ''),
    author: r.author == null ? undefined : String(r.author),
    description: r.description == null ? undefined : String(r.description),
    reference: String(r.reference ?? ''),
    install_type: r.install_type == null ? undefined : String(r.install_type),
    trust_level: r.trust_level == null ? undefined : String(r.trust_level),
    raw,
  };
}

export function count(db: Database.Database = getDb()): number {
  return (db.prepare('SELECT COUNT(*) as c FROM plugins_catalog').get() as { c: number }).c;
}

export function listAll(db: Database.Database = getDb()): PluginCatalogRow[] {
  const rows = db.prepare('SELECT * FROM plugins_catalog ORDER BY title COLLATE NOCASE ASC')
    .all() as Record<string, unknown>[];
  return rows.map(rowToEntry);
}

export function getById(id: string, db: Database.Database = getDb()): PluginCatalogRow | null {
  const r = db.prepare('SELECT * FROM plugins_catalog WHERE id = ?').get(id) as
    | Record<string, unknown> | undefined;
  return r ? rowToEntry(r) : null;
}

export interface PluginPageResult {
  items: PluginCatalogRow[];
  total: number;
}

/**
 * Query + paginate against the catalog. Installed/available filtering is
 * applied at SQL level when the caller provides the current set of
 * installed ids; this keeps the page boundary stable regardless of how
 * many entries match.
 */
export function listPaginated(
  filter: PluginListFilter,
  page: number,
  pageSize: number,
  db: Database.Database = getDb(),
): PluginPageResult {
  const q = (filter.q ?? '').trim();
  const mode = filter.filter ?? 'all';
  const installed = filter.installedIds ?? new Set<string>();
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (q) {
    clauses.push('(LOWER(title) LIKE ? OR LOWER(id) LIKE ? OR LOWER(COALESCE(description,\'\')) LIKE ? OR LOWER(COALESCE(author,\'\')) LIKE ?)');
    const needle = `%${q.toLowerCase()}%`;
    params.push(needle, needle, needle, needle);
  }
  if (mode === 'installed' && installed.size > 0) {
    const placeholders = Array.from(installed, () => '?').join(',');
    clauses.push(`id IN (${placeholders})`);
    for (const id of installed) params.push(id);
  } else if (mode === 'installed') {
    // Caller asked for installed but none exist => empty set.
    return { items: [], total: 0 };
  } else if (mode === 'available' && installed.size > 0) {
    const placeholders = Array.from(installed, () => '?').join(',');
    clauses.push(`id NOT IN (${placeholders})`);
    for (const id of installed) params.push(id);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) as c FROM plugins_catalog ${where}`)
    .get(...params) as { c: number }).c;
  const offset = Math.max(0, (page - 1) * pageSize);
  const sql = `SELECT * FROM plugins_catalog ${where} ORDER BY title COLLATE NOCASE ASC LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...params, pageSize, offset) as Record<string, unknown>[];
  return { items: rows.map(rowToEntry), total };
}

function canonicaliseId(entry: Record<string, unknown>): string {
  const explicit = typeof entry.id === 'string' && entry.id ? entry.id : '';
  if (explicit) return explicit.toLowerCase();
  const ref = typeof entry.reference === 'string' ? entry.reference : '';
  return ref.toLowerCase().replace(/\.git$/, '').replace(/\/$/, '');
}

/**
 * Replace the catalog table wholesale from a freshly-parsed mirror. Runs
 * in a single transaction: DELETE then INSERT, so readers never see a
 * half-populated table outside the transaction window.
 */
export function upsertMany(
  entries: Record<string, unknown>[],
  db: Database.Database = getDb(),
): number {
  const ins = db.prepare(`
    INSERT OR REPLACE INTO plugins_catalog
      (id, title, author, description, reference, install_type, trust_level, raw_json)
    VALUES (@id, @title, @author, @description, @reference, @install_type, @trust_level, @raw_json)
  `);
  const tx = db.transaction((rows: Record<string, unknown>[]) => {
    db.prepare('DELETE FROM plugins_catalog').run();
    for (const entry of rows) {
      const id = canonicaliseId(entry);
      if (!id) continue;
      const ref = typeof entry.reference === 'string' ? entry.reference : '';
      const title = String(entry.title ?? entry.name ?? id);
      ins.run({
        id,
        title,
        author: entry.author == null ? null : String(entry.author),
        description: entry.description == null ? null : String(entry.description),
        reference: ref,
        install_type: entry.install_type == null ? null : String(entry.install_type),
        trust_level: entry.trust_level == null ? null : String(entry.trust_level),
        raw_json: JSON.stringify(entry),
      });
    }
  });
  tx(entries);
  return count(db);
}
