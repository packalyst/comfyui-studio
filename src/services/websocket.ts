import type { ProgressUpdate } from '../types';

type ProgressCallback = (update: ProgressUpdate) => void;

export class ComfyUIWebSocket {
  private ws: WebSocket | null = null;
  private callbacks: Set<ProgressCallback> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as ProgressUpdate;
        this.callbacks.forEach(cb => cb(data));
      } catch {
        // ignore
      }
    };

    this.ws.onclose = () => {
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = () => {
      this.ws?.close();
    };
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }

  onProgress(cb: ProgressCallback) {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }
}

export const comfyWs = new ComfyUIWebSocket();
