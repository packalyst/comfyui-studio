// Bulk plugin install trigger for an imported template.
//
// Reads the `template_plugins` edges for the named template, filters out
// plugins that are already installed + enabled (via the catalog overlay),
// and queues an install task per remaining repo. Plugin install itself is
// fire-and-forget — each task surfaces its progress over
// `/plugins/progress/:taskId`, and readiness flips via the existing
// `plugin:installed` event (see `services/templates/eventSubscribers.ts`).
//
// The keys we consume are the same form written by the refresh + commit
// paths (`resolutionsToRepoKeys`): `owner/repo` lowercase, no scheme, no
// .git suffix. We match against `CatalogPlugin.repository`/`github`/`id`
// with the same normalization the plugin catalog overlay uses.

import { logger } from '../../lib/logger.js';
import * as templateRepo from '../../lib/db/templates.repo.js';
import * as pluginCache from '../plugins/cache.service.js';
import * as pluginInstall from '../plugins/install.service.js';
import type { CatalogPlugin } from '../plugins/cache.service.js';

export interface InstallMissingResult {
  queued: Array<{ pluginId: string; taskId: string }>;
  alreadyInstalled: string[];
  /** Repo keys with no matching row in the plugin catalog. */
  unknown: string[];
}

function normalizeRepoKey(raw: string): string {
  return raw.trim().toLowerCase()
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/\.git$/, '')
    .replace(/\/$/, '');
}

function catalogRepoKey(p: CatalogPlugin): string {
  return normalizeRepoKey(p.repository || p.github || '');
}

interface MatchResult {
  plugin?: CatalogPlugin;
}

function findCatalogEntry(repoKey: string, catalog: CatalogPlugin[]): MatchResult {
  const exact = catalog.find((p) => catalogRepoKey(p) === repoKey);
  if (exact) return { plugin: exact };
  // Fall back to matching by id (Manager's `cnr_id` maps to our `id`).
  const byId = catalog.find((p) => (p.id || '').toLowerCase() === repoKey);
  return byId ? { plugin: byId } : {};
}

/**
 * Install every plugin referenced by `templateName` that isn't already
 * installed + enabled. Returns the queued tasks and classification of each
 * edge so the UI can render a per-plugin status block.
 */
export async function installMissingPluginsForTemplate(
  templateName: string,
): Promise<InstallMissingResult> {
  const row = templateRepo.getTemplate(templateName);
  if (!row) throw new Error(`Template not found: ${templateName}`);
  const catalog = pluginCache.getAllPlugins(false);
  const queued: Array<{ pluginId: string; taskId: string }> = [];
  const alreadyInstalled: string[] = [];
  const unknown: string[] = [];
  // Dedup input — `template_plugins` already enforces uniqueness, but the
  // outer normalization may collapse near-duplicates.
  const seen = new Set<string>();
  for (const raw of row.plugins) {
    const key = normalizeRepoKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const match = findCatalogEntry(key, catalog);
    if (!match.plugin) {
      unknown.push(key);
      continue;
    }
    if (match.plugin.installed && !match.plugin.disabled) {
      alreadyInstalled.push(key);
      continue;
    }
    try {
      const taskId = await pluginInstall.installPlugin(
        match.plugin.id,
        match.plugin,
        undefined,
      );
      queued.push({ pluginId: match.plugin.id, taskId });
    } catch (err) {
      // Surface the failure in the unknown bucket so the UI can show it —
      // individual install errors shouldn't kill the whole batch.
      logger.warn('installMissingPlugins: queue failed', {
        template: templateName,
        repoKey: key,
        error: err instanceof Error ? err.message : String(err),
      });
      unknown.push(key);
    }
  }
  logger.info('installMissingPlugins: completed queue pass', {
    template: templateName,
    queued: queued.length,
    alreadyInstalled: alreadyInstalled.length,
    unknown: unknown.length,
  });
  return { queued, alreadyInstalled, unknown };
}
