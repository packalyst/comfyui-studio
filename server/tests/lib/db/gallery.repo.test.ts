// Gallery repo tests — insert/delete, paginate, filter.

import { describe, expect, it } from 'vitest';
import * as repo from '../../../src/lib/db/gallery.repo.js';
import { useFreshDb } from './_helpers.js';

function mkRow(overrides: Partial<repo.GalleryRow>): repo.GalleryRow {
  return {
    id: 'p-f.png',
    filename: 'f.png',
    subfolder: '',
    type: 'output',
    mediaType: 'image',
    url: '/api/view?filename=f.png',
    promptId: 'p',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('gallery repo', () => {
  useFreshDb();

  it('insert + getById round-trips', () => {
    repo.insert(mkRow({ id: 'r1', filename: 'r1.png' }));
    const got = repo.getById('r1');
    expect(got).not.toBeNull();
    expect(got?.filename).toBe('r1.png');
    expect(got?.mediaType).toBe('image');
  });

  it('remove returns true on hit, false on miss', () => {
    repo.insert(mkRow({ id: 'r2' }));
    expect(repo.remove('r2')).toBe(true);
    expect(repo.remove('nope')).toBe(false);
    expect(repo.getById('r2')).toBeNull();
  });

  it('listPaginated sorts newest first by default', () => {
    for (let i = 0; i < 5; i++) {
      repo.insert(mkRow({ id: `r${i}`, filename: `${i}.png`, createdAt: 1000 + i }));
    }
    const { items, total } = repo.listPaginated({}, 1, 10);
    expect(total).toBe(5);
    expect(items.map(r => r.id)).toEqual(['r4', 'r3', 'r2', 'r1', 'r0']);
  });

  it('listPaginated filters by mediaType', () => {
    repo.insert(mkRow({ id: 'a', mediaType: 'image', createdAt: 10 }));
    repo.insert(mkRow({ id: 'b', mediaType: 'video', createdAt: 20 }));
    repo.insert(mkRow({ id: 'c', mediaType: 'image', createdAt: 30 }));
    const { items, total } = repo.listPaginated({ mediaType: 'image' }, 1, 10);
    expect(total).toBe(2);
    expect(items.map(r => r.id)).toEqual(['c', 'a']);
  });

  it('listPaginated paginates correctly across pages', () => {
    for (let i = 0; i < 15; i++) {
      repo.insert(mkRow({ id: `p${i}`, createdAt: i }));
    }
    const p1 = repo.listPaginated({}, 1, 5);
    const p2 = repo.listPaginated({}, 2, 5);
    const p3 = repo.listPaginated({}, 3, 5);
    expect(p1.total).toBe(15);
    expect(p1.items.length).toBe(5);
    expect(p2.items.length).toBe(5);
    expect(p3.items.length).toBe(5);
    const allIds = [...p1.items, ...p2.items, ...p3.items].map(r => r.id);
    expect(new Set(allIds).size).toBe(15);
  });

  it('rebuildFromScan bulk-upserts idempotently', () => {
    const rows = Array.from({ length: 10 }, (_, i) =>
      mkRow({ id: `b${i}`, filename: `b${i}.png`, createdAt: i }),
    );
    expect(repo.rebuildFromScan(rows)).toBe(10);
    // Running the same batch again should not duplicate.
    repo.rebuildFromScan(rows);
    expect(repo.count()).toBe(10);
  });

  it('sort=oldest reverses order', () => {
    for (let i = 0; i < 3; i++) {
      repo.insert(mkRow({ id: `s${i}`, createdAt: 100 + i }));
    }
    const asc = repo.listPaginated({ sort: 'oldest' }, 1, 10);
    expect(asc.items.map(r => r.id)).toEqual(['s0', 's1', 's2']);
  });
});
