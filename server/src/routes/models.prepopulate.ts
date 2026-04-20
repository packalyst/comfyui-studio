// Catalog pre-populate helper for the unified /models/download-custom route.
//
// Split out of `models.routes.ts` to keep that file under the 250-line cap.
// Consumed exclusively by `handleDownloadCustom` — nothing else here should
// import these symbols.

import * as catalog from '../services/catalog.js';
import { formatBytes } from '../lib/format.js';

/**
 * Optional metadata a client (typically a civitai or HF card) supplies at
 * download start. Pre-populating the catalog with this lets the Models page
 * show a rich row + "Downloading…" badge immediately, instead of waiting for
 * the disk scan to pick up the file on completion.
 */
export interface DownloadCustomMeta {
  type?: string;
  description?: string;
  reference?: string;
  size_bytes?: number;
  thumbnail?: string;
  gated?: boolean;
  source?: string;
}

/**
 * Prepopulate the catalog with whatever metadata the caller handed us. This
 * is purely additive: if the row already exists, existing `name`/`url`/etc.
 * is preserved and only the new fields (thumbnail, downloading flag, error
 * clear, size hint) are merged in. Never throws — pre-populate is best-effort
 * and must not block the download path.
 */
export function prepopulateCatalog(
  filename: string,
  modelDir: string,
  hfUrl: string,
  meta: DownloadCustomMeta | undefined,
  modelName: string | undefined,
): void {
  if (!filename) return;
  try {
    catalog.upsertModel({
      filename,
      name: modelName || filename,
      type: meta?.type || 'other',
      save_path: modelDir,
      url: hfUrl,
      description: meta?.description,
      reference: meta?.reference,
      thumbnail: meta?.thumbnail,
      gated: meta?.gated,
      size_bytes: meta?.size_bytes,
      size_pretty: meta?.size_bytes ? formatBytes(meta.size_bytes) : '',
      size_fetched_at: meta?.size_bytes ? new Date().toISOString() : null,
      source: meta?.source || 'user',
      downloading: true,
      // explicit undefined so a retry after failure clears the prior error
      error: undefined,
    });
  } catch {
    // best-effort; never block the download path
  }
}
