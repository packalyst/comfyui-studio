// First-boot migration from `<server>/data/` runtime files to the persistent
// runtime-state dir under `~/.config/comfyui-studio/runtime/`. This runs
// exactly once per boot before routes mount. If the new target already exists,
// we leave the old file where it is (the operator has already migrated, or a
// parallel service wrote fresh state first).
//
// `renameSync` is fast on the same filesystem; if the source and target live
// on different devices (EXDEV) we fall back to a copy+delete. Any error is
// logged but never thrown — a broken migration must not block startup.

import fs from 'fs';
import path from 'path';
import { paths } from './paths.js';
import { logger } from '../lib/logger.js';

interface LegacyMove {
  /** Absolute path to the legacy location (under BUNDLED_DATA_DIR). */
  from: string;
  /** Absolute path to the new location (under runtimeStateDir). */
  to: string;
  /** Human label for log output. */
  label: string;
  /** True when `from`/`to` are directories, not files. */
  isDir?: boolean;
}

function legacyMoves(): LegacyMove[] {
  const legacyRoot = paths.dataDir;
  return [
    {
      label: 'model-cache',
      from: path.join(legacyRoot, 'model-cache.json'),
      to: paths.modelCachePath,
    },
    {
      label: 'plugin-history',
      from: path.join(legacyRoot, '.comfyui-manager-history.json'),
      to: paths.pluginHistoryPath,
    },
    {
      label: 'download-history',
      from: path.join(legacyRoot, 'download-history.json'),
      to: paths.downloadHistoryPath,
    },
    {
      label: 'env-config',
      from: path.join(legacyRoot, 'env-config.json'),
      to: paths.envConfigFile,
    },
    {
      label: 'launch-options',
      from: path.join(legacyRoot, 'comfyui-launch-options.json'),
      to: paths.launchOptionsPath,
    },
    {
      label: 'network-checks',
      from: path.join(legacyRoot, 'network-checks'),
      to: paths.networkCheckDir,
      isDir: true,
    },
    {
      label: 'reset-logs',
      from: path.join(legacyRoot, 'logs'),
      to: paths.resetLogsDir,
      isDir: true,
    },
  ];
}

function moveOne(m: LegacyMove): void {
  // Skip if legacy file/dir is absent, or if the new location is already
  // populated (operator already migrated, or service wrote fresh state).
  if (!fs.existsSync(m.from)) return;
  if (fs.existsSync(m.to)) return;
  // Skip when the legacy path IS the new path (e.g. DATA_DIR override points
  // at the runtime dir). Nothing to do.
  if (path.resolve(m.from) === path.resolve(m.to)) return;
  try {
    fs.mkdirSync(path.dirname(m.to), { recursive: true, mode: 0o700 });
    try {
      fs.renameSync(m.from, m.to);
    } catch (err) {
      // EXDEV: cross-device link not permitted. Fall back to copy+delete.
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EXDEV') throw err;
      if (m.isDir) copyDirSync(m.from, m.to);
      else fs.copyFileSync(m.from, m.to);
      if (m.isDir) fs.rmSync(m.from, { recursive: true, force: true });
      else fs.unlinkSync(m.from);
    }
    logger.info('migrated legacy runtime state', {
      label: m.label, from: m.from, to: m.to,
    });
  } catch (err) {
    logger.warn('legacy runtime-state migration failed', {
      label: m.label, from: m.from, to: m.to, error: String(err),
    });
  }
}

function copyDirSync(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true, mode: 0o700 });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirSync(s, d);
    else fs.copyFileSync(s, d);
  }
}

/**
 * Move runtime-written JSON state out of the bundled data dir and into the
 * persistent runtime-state dir. Safe to call more than once — each move is
 * a no-op when the new location already exists.
 */
export function migrateLegacyPaths(): void {
  for (const m of legacyMoves()) moveOne(m);
}
