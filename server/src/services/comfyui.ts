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

export async function getGalleryItems(): Promise<GalleryItem[]> {
  const history = await fetchComfyUI<Record<string, { outputs?: Record<string, { images?: Array<Record<string, string>>; videos?: Array<Record<string, string>> }> }>>('/api/history?max_items=100');
  const items: GalleryItem[] = [];
  for (const [promptId, entry] of Object.entries(history)) {
    if (!entry.outputs) continue;
    for (const nodeOutput of Object.values(entry.outputs)) {
      for (const img of nodeOutput.images || []) {
        items.push({
          id: `${promptId}-${img.filename}`,
          filename: img.filename,
          subfolder: img.subfolder || '',
          type: img.type || 'output',
          mediaType: 'image',
          url: `/api/view?filename=${encodeURIComponent(img.filename)}&subfolder=${encodeURIComponent(img.subfolder || '')}&type=${encodeURIComponent(img.type || 'output')}`,
          promptId,
        });
      }
      for (const vid of nodeOutput.videos || []) {
        items.push({
          id: `${promptId}-${vid.filename}`,
          filename: vid.filename,
          subfolder: vid.subfolder || '',
          type: vid.type || 'output',
          mediaType: 'video',
          url: `/api/view?filename=${encodeURIComponent(vid.filename)}&subfolder=${encodeURIComponent(vid.subfolder || '')}&type=${encodeURIComponent(vid.type || 'output')}`,
          promptId,
        });
      }
    }
  }
  return items;
}
