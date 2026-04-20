// Test helper — spin up a fresh sqlite DB in a tmpdir per test so the
// in-process cached connection in `connection.ts` can be reset between
// cases. Every DB-touching test file consumes `withFreshDb` so nothing
// leaks across tests.

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { afterEach, beforeEach } from 'vitest';
import { resetForTests } from '../../../src/lib/db/connection.js';

export interface FreshDbFixture {
  dbPath: string;
  cleanup(): void;
}

export function makeFreshDbFixture(): FreshDbFixture {
  const dir = mkdtempSync(path.join(tmpdir(), 'studio-db-'));
  const dbPath = path.join(dir, 'studio.db');
  process.env.STUDIO_SQLITE_PATH = dbPath;
  resetForTests();
  return {
    dbPath,
    cleanup() {
      resetForTests();
      delete process.env.STUDIO_SQLITE_PATH;
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    },
  };
}

/** Attach before/after hooks that give every `it` a fresh sqlite file. */
export function useFreshDb(): { current(): FreshDbFixture } {
  let fixture: FreshDbFixture | null = null;
  beforeEach(() => { fixture = makeFreshDbFixture(); });
  afterEach(() => { fixture?.cleanup(); fixture = null; });
  return { current: () => {
    if (!fixture) throw new Error('fixture not ready');
    return fixture;
  } };
}
