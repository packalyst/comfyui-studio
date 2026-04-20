// Wires the process-local event bus (`lib/events`) to the persistent catalog
// store. When a download starts, the route handler has already pre-populated
// the catalog with rich metadata + a `downloading: true` marker; these hooks
// flip those flags as the lifecycle progresses:
//
//   download completes successfully -> `downloading: false`, error cleared
//   download fails / cancels         -> `downloading: false`, error stamped
//
// Called once at boot from `server/src/index.ts`.

import { logger } from '../lib/logger.js';
import * as bus from '../lib/events.js';
import { markInstalled, markDownloadFailed } from './catalog.js';

let wired = false;

export function wireCatalogEventHandlers(): void {
  if (wired) return;
  wired = true;
  subscribe();
}

/** Test-only: force re-subscription after `bus.resetForTests()`. */
export function rewireForTests(): void {
  wired = true;
  subscribe();
}

function subscribe(): void {
  bus.on('model:installed', ({ filename }) => {
    try {
      markInstalled(filename);
    } catch (err) {
      logger.warn('catalog model:installed hook failed', {
        filename, error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  bus.on('model:download-failed', ({ filename, error }) => {
    try {
      markDownloadFailed(filename, error);
    } catch (err) {
      logger.warn('catalog model:download-failed hook failed', {
        filename, error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  bus.on('model:removed', ({ filename }) => {
    // When the user deletes a file, keep the catalog entry (it's a pure
    // metadata row), but clear any lingering in-flight flag so the UI goes
    // back to a clean "Not installed / Download" state.
    try {
      markInstalled(filename); // no fileSize -> clears downloading + error, leaves size_bytes
    } catch (err) {
      logger.warn('catalog model:removed hook failed', {
        filename, error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
