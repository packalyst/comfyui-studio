// Plugin catalog cache. Reads the bundled `all_nodes.mirrored.json`, seeds
// the `plugins_catalog` sqlite table on first boot, then serves every
// lookup from sqlite. Install state is overlaid from `info.service` each
// call because it changes at runtime on install/uninstall events.
//
// The `update-cache` endpoint rewrites the mirror JSON *and* re-seeds
// sqlite in the same transaction — JSON stays the source of truth for
// versioning, sqlite is the query engine.

import fs from 'fs';
import { paths } from '../../config/paths.js';
import { logger } from '../../lib/logger.js';
import { atomicWrite } from '../../lib/fs.js';
import { getAllInstalledPlugins } from './info.service.js';
import * as pluginRepo from '../../lib/db/plugins.repo.js';
import { entryToCatalogPlugin } from './cache.overlay.js';
import type { CatalogPlugin } from './cache.overlay.js';
import { overlayInstalled } from './cache.overlay.js';

export type { CatalogPlugin } from './cache.overlay.js';

const CACHE_DURATION_MS = 60 * 60 * 1000; // 1h

let cached: CatalogPlugin[] = [];
let lastFetchTime = 0;
let seedAttempted = false;

function loadMirrorJson(): Record<string, unknown>[] {
  try {
    if (!fs.existsSync(paths.nodeListPath)) {
      logger.warn('plugin mirror json missing', { path: paths.nodeListPath });
      return [];
    }
    const raw = fs.readFileSync(paths.nodeListPath, 'utf-8');
    const parsed = JSON.parse(raw) as { nodes?: Record<string, unknown>[] };
    return Array.isArray(parsed.nodes) ? parsed.nodes : [];
  } catch (err) {
    logger.error('plugin mirror load failed', { message: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

function seedIfEmpty(): void {
  if (seedAttempted) return;
  seedAttempted = true;
  try {
    if (pluginRepo.count() === 0) {
      const entries = loadMirrorJson();
      if (entries.length > 0) pluginRepo.upsertMany(entries);
    }
  } catch (err) {
    logger.error('plugin catalog seed failed', { message: err instanceof Error ? err.message : String(err) });
  }
}

function loadFromDb(): CatalogPlugin[] {
  seedIfEmpty();
  try {
    return pluginRepo.listAll().map((r) => entryToCatalogPlugin(r.raw));
  } catch (err) {
    logger.error('plugin catalog read failed', { message: err instanceof Error ? err.message : String(err) });
    return [];
  }
}

/** Return the merged plugin list. Cached for 1h unless forceRefresh. */
export function getAllPlugins(forceRefresh = false): CatalogPlugin[] {
  const now = Date.now();
  if (!forceRefresh && cached.length > 0 && now - lastFetchTime < CACHE_DURATION_MS) {
    cached = overlayInstalled(cached, getAllInstalledPlugins());
    return cached;
  }
  const source = loadFromDb();
  cached = overlayInstalled(source, getAllInstalledPlugins());
  lastFetchTime = now;
  return cached;
}

/** Clear the cache. Called after install/uninstall so next read re-scans disk. */
export function clearCache(): void {
  cached = [];
  lastFetchTime = 0;
}

/** Clear the cache entry for a specific plugin id (global reset in practice). */
export function clearPluginCache(_pluginId: string): void {
  clearCache();
}

/** Refresh on-disk installed plugin info and re-overlay onto cached catalog. */
export function refreshInstalledPlugins(): ReturnType<typeof getAllInstalledPlugins> {
  const installed = getAllInstalledPlugins();
  if (cached.length > 0) cached = overlayInstalled(cached, installed);
  return installed;
}

export function getCacheStatus(): { count: number; lastUpdate: number; isValid: boolean } {
  return {
    count: cached.length,
    lastUpdate: lastFetchTime,
    isValid: Date.now() - lastFetchTime < CACHE_DURATION_MS,
  };
}

/**
 * Overwrite the bundled mirror file AND the sqlite catalog table. Used by
 * POST /api/plugins/update-cache.
 */
export function writeMirror(nodes: Record<string, unknown>[]): void {
  atomicWrite(paths.nodeListPath, JSON.stringify({ nodes }, null, 2), { mode: 0o644 });
  try { pluginRepo.upsertMany(nodes); }
  catch (err) {
    logger.error('plugin catalog reseed failed', { message: err instanceof Error ? err.message : String(err) });
  }
  clearCache();
  seedAttempted = true;
}

/**
 * Force-reseed sqlite from the current mirror JSON and drop the in-memory
 * overlay cache. Invoked by POST /api/plugins/update-cache even when the
 * mirror itself hasn't changed, so the two stores never drift.
 */
export function reseedFromMirror(): number {
  const entries = loadMirrorJson();
  let n = 0;
  try { n = pluginRepo.upsertMany(entries); }
  catch (err) {
    logger.error('plugin catalog reseed failed', { message: err instanceof Error ? err.message : String(err) });
  }
  clearCache();
  seedAttempted = true;
  return n;
}
