// Tests for parsePageQuery + paginate.
// Covers default fallbacks, clamping, page overflow, and empty lists.

import { describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { parsePageQuery, paginate } from '../../src/lib/pagination.js';

// Minimal Request stub — we only read .query.
function mkReq(query: Record<string, string | undefined>): Request {
  return { query } as unknown as Request;
}

describe('parsePageQuery', () => {
  const defaults = { defaultPageSize: 50, maxPageSize: 200 };

  it('returns defaults when no params provided', () => {
    const r = parsePageQuery(mkReq({}), defaults);
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(50);
    expect(r.isPaginated).toBe(false);
  });

  it('marks isPaginated true when page is present', () => {
    const r = parsePageQuery(mkReq({ page: '2' }), defaults);
    expect(r.isPaginated).toBe(true);
    expect(r.page).toBe(2);
  });

  it('clamps pageSize to maxPageSize', () => {
    const r = parsePageQuery(mkReq({ page: '1', pageSize: '10000' }), defaults);
    expect(r.pageSize).toBe(200);
  });

  it('clamps page below 1', () => {
    const r = parsePageQuery(mkReq({ page: '-5' }), defaults);
    expect(r.page).toBe(1);
  });

  it('clamps pageSize below 1', () => {
    const r = parsePageQuery(mkReq({ page: '1', pageSize: '0' }), defaults);
    expect(r.pageSize).toBe(1);
  });

  it('rejects non-numeric values and falls back to defaults', () => {
    const r = parsePageQuery(mkReq({ page: 'abc', pageSize: 'zzz' }), defaults);
    expect(r.page).toBe(1);
    expect(r.pageSize).toBe(50);
    // ?page=abc is still "provided" — paginated mode engages.
    expect(r.isPaginated).toBe(true);
  });

  it('truncates fractional pageSize', () => {
    const r = parsePageQuery(mkReq({ page: '1', pageSize: '25.9' }), defaults);
    expect(r.pageSize).toBe(25);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 95 }, (_, i) => i + 1);

  it('returns first page and reports hasMore', () => {
    const e = paginate(items, 1, 20);
    expect(e.page).toBe(1);
    expect(e.pageSize).toBe(20);
    expect(e.total).toBe(95);
    expect(e.items).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(e.hasMore).toBe(true);
  });

  it('returns last page without hasMore', () => {
    const e = paginate(items, 5, 20);
    expect(e.page).toBe(5);
    expect(e.items.length).toBe(15);
    expect(e.items[0]).toBe(81);
    expect(e.items[14]).toBe(95);
    expect(e.hasMore).toBe(false);
  });

  it('overflow page snaps to the last page', () => {
    const e = paginate(items, 999, 20);
    expect(e.page).toBe(5);
    expect(e.items[0]).toBe(81);
    expect(e.hasMore).toBe(false);
  });

  it('empty list yields empty items, page=1, total=0, hasMore=false', () => {
    const e = paginate([], 1, 50);
    expect(e.items).toEqual([]);
    expect(e.page).toBe(1);
    expect(e.pageSize).toBe(50);
    expect(e.total).toBe(0);
    expect(e.hasMore).toBe(false);
  });

  it('empty list with overflow page still snaps to 1', () => {
    const e = paginate([], 50, 20);
    expect(e.page).toBe(1);
    expect(e.items).toEqual([]);
    expect(e.hasMore).toBe(false);
  });

  it('pageSize larger than total still returns all items with hasMore=false', () => {
    const e = paginate([1, 2, 3], 1, 100);
    expect(e.items).toEqual([1, 2, 3]);
    expect(e.total).toBe(3);
    expect(e.hasMore).toBe(false);
  });
});
