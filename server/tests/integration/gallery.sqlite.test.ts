// Integration test — hit `GET /gallery` against a seeded sqlite DB.
//
// We mount only the gallery router on a throwaway Express app, bypass the
// ComfyUI fetch (the service's `ensureSeeded` sees rows already > 0 and
// skips the network call), and verify the response shape is identical to
// Phase 8.

import { describe, expect, it, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'net';
import galleryRouter from '../../src/routes/gallery.routes.js';
import * as repo from '../../src/lib/db/gallery.repo.js';
import { useFreshDb } from '../lib/db/_helpers.js';

function startApp(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use(galleryRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe('GET /gallery (sqlite-backed)', () => {
  useFreshDb();

  beforeEach(() => {
    // Seed the DB so ensureSeeded is a no-op and the ComfyUI fetch is skipped.
    for (let i = 0; i < 7; i++) {
      repo.insert({
        id: `p-${i}.png`,
        filename: `${i}.png`,
        subfolder: '',
        type: 'output',
        mediaType: i % 2 === 0 ? 'image' : 'video',
        url: `/api/view?filename=${i}.png`,
        promptId: 'p',
        createdAt: 1000 + i,
      });
    }
  });

  it('unpaginated: returns a flat array preserving GalleryItem shape', async () => {
    const app = await startApp();
    try {
      const res = await fetch(`${app.url}/gallery`);
      expect(res.status).toBe(200);
      const body = await res.json() as Array<Record<string, unknown>>;
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBe(7);
      expect(body[0]).toHaveProperty('id');
      expect(body[0]).toHaveProperty('filename');
      expect(body[0]).toHaveProperty('mediaType');
      expect(body[0]).toHaveProperty('url');
    } finally { await app.close(); }
  });

  it('paginated: returns PageEnvelope with page/pageSize/total/hasMore', async () => {
    const app = await startApp();
    try {
      const res = await fetch(`${app.url}/gallery?page=1&pageSize=3`);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        items: unknown[]; page: number; pageSize: number; total: number; hasMore: boolean;
      };
      expect(body.page).toBe(1);
      expect(body.pageSize).toBe(3);
      expect(body.total).toBe(7);
      expect(body.items.length).toBe(3);
      expect(body.hasMore).toBe(true);
    } finally { await app.close(); }
  });

  it('paginated with mediaType filter applies before paging', async () => {
    const app = await startApp();
    try {
      const res = await fetch(`${app.url}/gallery?page=1&pageSize=50&mediaType=image`);
      const body = await res.json() as { items: Array<{ mediaType: string }>; total: number };
      expect(body.total).toBe(4);
      expect(body.items.every(r => r.mediaType === 'image')).toBe(true);
    } finally { await app.close(); }
  });
});
