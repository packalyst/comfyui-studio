const COMFYUI_URL = process.env.COMFYUI_URL || 'http://localhost:8188';

export function getComfyUIUrl(): string {
  return COMFYUI_URL;
}

export async function fetchComfyUI<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${COMFYUI_URL}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  if (!res.ok) {
    // Surface ComfyUI's error body (usually JSON with { error: { message, details, ... } })
    // so the caller can show a meaningful message instead of a bare status code.
    let detail = '';
    try { detail = ' — ' + (await res.text()).slice(0, 1000); } catch { /* ignore */ }
    throw new Error(`ComfyUI API error: ${res.status} ${res.statusText} at ${path}${detail}`);
  }
  return res.json() as Promise<T>;
}

export async function getSystemStats() {
  return fetchComfyUI('/api/system_stats');
}

export async function getQueue() {
  const data = await fetchComfyUI<{ queue_running: unknown[]; queue_pending: unknown[] }>('/api/queue');
  return {
    queue_running: data.queue_running?.length || 0,
    queue_pending: data.queue_pending?.length || 0,
  };
}

export async function getHistory(maxItems = 50) {
  return fetchComfyUI(`/api/history?max_items=${maxItems}`);
}

export async function getObjectInfo() {
  return fetchComfyUI('/api/object_info');
}

export async function submitPrompt(
  workflow: Record<string, unknown>,
  opts?: { attachApiKey?: boolean },
) {
  const body: Record<string, unknown> = { prompt: workflow };
  if (opts?.attachApiKey) {
    const { getApiKey } = await import('./settings.js');
    const apiKey = getApiKey();
    if (apiKey) body.extra_data = { api_key_comfy_org: apiKey };
  }
  return fetchComfyUI<{ prompt_id: string }>('/api/prompt', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function proxyView(filename: string, subfolder?: string): Promise<Response> {
  const params = new URLSearchParams({ filename });
  if (subfolder) params.set('subfolder', subfolder);
  return fetch(`${COMFYUI_URL}/api/view?${params.toString()}`);
}

export async function uploadImage(formData: FormData): Promise<Response> {
  return fetch(`${COMFYUI_URL}/upload/image`, {
    method: 'POST',
    body: formData,
  });
}

export interface GalleryItem {
  id: string;
  filename: string;
  subfolder: string;
  type: string;
  mediaType: string;
  url: string;
  promptId: string;
}

/**
 * ComfyUI's history schema is inconsistent about where media lands:
 *   - SaveImage   → nodeOutput.images = [{filename: "foo.png", ...}]
 *   - SaveVideo   → nodeOutput.images = [{filename: "foo.mp4", ...}] with `animated: true`  (not under .videos!)
 *   - SaveAudio   → nodeOutput.audio  = [{filename: "foo.mp3", ...}]  (entirely separate key)
 *   - Some older nodes might use .videos directly.
 *
 * The safest approach is to walk every array-valued key, ignore markers like `animated`,
 * and infer mediaType from the file extension.
 */
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v']);
const AUDIO_EXTS = new Set(['wav', 'mp3', 'ogg', 'flac', 'm4a', 'opus', 'aac']);

export function detectMediaType(filename: string): 'image' | 'video' | 'audio' {
  const ext = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  return 'image';
}

interface OutputFile { filename: string; subfolder?: string; type?: string }

/** Collect every file-shaped entry from one node's output bag, regardless of which key holds it. */
export function collectNodeOutputFiles(nodeOutput: Record<string, unknown>): OutputFile[] {
  const files: OutputFile[] = [];
  for (const value of Object.values(nodeOutput)) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (item && typeof item === 'object' && typeof (item as OutputFile).filename === 'string') {
        files.push(item as OutputFile);
      }
    }
  }
  return files;
}

export async function getGalleryItems(): Promise<GalleryItem[]> {
  const history = await fetchComfyUI<Record<string, { outputs?: Record<string, Record<string, unknown>> }>>('/api/history?max_items=100');
  const items: GalleryItem[] = [];
  for (const [promptId, entry] of Object.entries(history)) {
    if (!entry.outputs) continue;
    for (const nodeOutput of Object.values(entry.outputs)) {
      for (const f of collectNodeOutputFiles(nodeOutput)) {
        const subfolder = f.subfolder || '';
        const type = f.type || 'output';
        items.push({
          id: `${promptId}-${f.filename}`,
          filename: f.filename,
          subfolder,
          type,
          mediaType: detectMediaType(f.filename),
          url: `/api/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(subfolder)}&type=${encodeURIComponent(type)}`,
          promptId,
        });
      }
    }
  }
  return items;
}
