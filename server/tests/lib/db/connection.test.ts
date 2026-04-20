// Connection-layer tests: schema creation, WAL pragma, schema_version row.

import { describe, expect, it } from 'vitest';
import { getDb, getSchemaVersion } from '../../../src/lib/db/connection.js';
import { SCHEMA_VERSION } from '../../../src/lib/db/schema.js';
import { useFreshDb } from './_helpers.js';

describe('db connection', () => {
  useFreshDb();

  it('creates the two tables + schema_version on first open', () => {
    const db = getDb();
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as Array<{ name: string }>;
    const names = tables.map(t => t.name);
    expect(names).toContain('gallery');
    expect(names).toContain('plugins_catalog');
    expect(names).toContain('schema_version');
  });

  it('enables WAL journal_mode', () => {
    const db = getDb();
    const pragma = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
    // better-sqlite3 returns an array of row objects for pragma queries.
    expect(pragma[0].journal_mode.toLowerCase()).toBe('wal');
  });

  it('stamps schema_version = current on first create', () => {
    getDb();
    expect(getSchemaVersion()).toBe(SCHEMA_VERSION);
  });

  it('creates the expected indexes', () => {
    const db = getDb();
    const indexes = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name",
    ).all() as Array<{ name: string }>;
    const names = indexes.map(i => i.name);
    expect(names).toContain('idx_gallery_createdAt');
    expect(names).toContain('idx_gallery_mediaType');
    expect(names).toContain('idx_gallery_template');
    expect(names).toContain('idx_gallery_prompt');
    expect(names).toContain('idx_plugins_title');
    expect(names).toContain('idx_plugins_author');
  });
});
