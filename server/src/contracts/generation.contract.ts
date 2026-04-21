// Canonical shapes for generation output and model dependency resolution.

import type { MediaType } from '../lib/mediaType.js';

export interface GalleryItem {
  id: string;
  filename: string;
  subfolder: string;
  type: string;
  mediaType: string;
  url: string;
  promptId: string;
  /**
   * Optional generation metadata captured at execution time from ComfyUI's
   * history entry. Wave F adds these; rows written before Wave F have them
   * all null/undefined. `workflowJson` is the full API-format workflow
   * object stringified — required for the regenerate endpoint.
   */
  workflowJson?: string | null;
  promptText?: string | null;
  negativeText?: string | null;
  seed?: number | null;
  model?: string | null;
  sampler?: string | null;
  steps?: number | null;
  cfg?: number | null;
  width?: number | null;
  height?: number | null;
  templateName?: string | null;
}

/** One output row returned from `GET /api/history/:promptId`. */
export interface HistoryOutput {
  filename: string;
  subfolder: string;
  type: string;
  mediaType: MediaType;
}

/** Row returned from the launcher's `/api/models` scan. */
export interface LauncherModelEntry {
  name: string;
  type: string;
  filename: string;
  url: string;
  size?: string;
  fileSize?: number;
  installed: boolean;
  save_path?: string;
}

/** Per-model row returned from `POST /api/check-dependencies`. */
export interface RequiredModelInfo {
  name: string;
  directory: string;
  url: string;
  size?: number;
  /** Pretty-formatted size string (e.g. "9.14 GB"), derived from catalog's size_bytes. */
  size_pretty?: string;
  installed: boolean;
  gated?: boolean;
  gated_message?: string;
}
