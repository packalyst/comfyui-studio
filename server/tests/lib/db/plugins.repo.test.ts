// Plugins repo tests — paginate, search, upsertMany.

import { describe, expect, it } from 'vitest';
import * as repo from '../../../src/lib/db/plugins.repo.js';
import { useFreshDb } from './_helpers.js';

function mkEntry(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    name: `Plugin ${id}`,
    title: `Plugin ${id}`,
    description: `desc for ${id}`,
    author: 'alice',
    reference: `https://github.com/alice/${id}`,
    repository: `https://github.com/alice/${id}`,
    install_type: 'git-clone',
    tags: ['x'],
    ...over,
  };
}

describe('plugins repo', () => {
  useFreshDb();

  it('upsertMany inserts rows; count reports total', () => {
    const entries = Array.from({ length: 5 }, (_, i) => mkEntry(`p${i}`));
    const n = repo.upsertMany(entries);
    expect(n).toBe(5);
    expect(repo.count()).toBe(5);
  });

  it('upsertMany replaces the catalog wholesale on a second call', () => {
    repo.upsertMany([mkEntry('old1'), mkEntry('old2')]);
    repo.upsertMany([mkEntry('new1')]);
    expect(repo.count()).toBe(1);
    expect(repo.getById('new1')).not.toBeNull();
    expect(repo.getById('old1')).toBeNull();
  });

  it('listPaginated returns sorted results + total', () => {
    repo.upsertMany([
      mkEntry('b-plug', { title: 'Beta' }),
      mkEntry('a-plug', { title: 'Alpha' }),
      mkEntry('c-plug', { title: 'Gamma' }),
    ]);
    const { items, total } = repo.listPaginated({}, 1, 10);
    expect(total).toBe(3);
    expect(items.map(r => r.title)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('listPaginated filters by q substring across title/id/description/author', () => {
    repo.upsertMany([
      mkEntry('video-helper', { title: 'Video Helper', description: 'handles clips' }),
      mkEntry('image-plug',   { title: 'Image Tools',  description: 'edits pixels', author: 'bob' }),
      mkEntry('audio-plug',   { title: 'Audio Mix',    description: 'audio glue' }),
    ]);
    const byTitle = repo.listPaginated({ q: 'video' }, 1, 10);
    expect(byTitle.total).toBe(1);
    expect(byTitle.items[0].id).toBe('video-helper');

    const byAuthor = repo.listPaginated({ q: 'bob' }, 1, 10);
    expect(byAuthor.total).toBe(1);
    expect(byAuthor.items[0].id).toBe('image-plug');

    const byDesc = repo.listPaginated({ q: 'glue' }, 1, 10);
    expect(byDesc.items[0].id).toBe('audio-plug');
  });

  it('listPaginated installed/available filters respect installedIds set', () => {
    repo.upsertMany([mkEntry('p1'), mkEntry('p2'), mkEntry('p3')]);
    const inst = new Set(['p1', 'p3']);
    const installed = repo.listPaginated({ filter: 'installed', installedIds: inst }, 1, 10);
    expect(installed.total).toBe(2);
    expect(installed.items.map(r => r.id).sort()).toEqual(['p1', 'p3']);
    const available = repo.listPaginated({ filter: 'available', installedIds: inst }, 1, 10);
    expect(available.total).toBe(1);
    expect(available.items[0].id).toBe('p2');
  });

  it('listPaginated installed with empty set returns empty', () => {
    repo.upsertMany([mkEntry('p1')]);
    const r = repo.listPaginated({ filter: 'installed', installedIds: new Set() }, 1, 10);
    expect(r.total).toBe(0);
    expect(r.items).toEqual([]);
  });

  it('upsertMany preserves full raw entry in raw_json', () => {
    repo.upsertMany([mkEntry('full', { extra: { deep: { v: 42 } } })]);
    const row = repo.getById('full');
    expect(row?.raw.extra).toEqual({ deep: { v: 42 } });
  });
});
