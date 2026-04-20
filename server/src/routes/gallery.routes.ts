// Gallery listing — flat array of every generated output the server knows
// about, backed by the `gallery` sqlite table. On first boot the table is
// seeded from ComfyUI's history (see `services/gallery.service.ts`); after
// that, new rows land on `execution_complete` WS events. Fails open to an
// empty list so the dashboard still renders when ComfyUI is unreachable.

import { Router, type Request, type Response } from 'express';
import * as gallery from '../services/gallery.service.js';
import { parsePageQuery } from '../lib/pagination.js';

const router = Router();

router.get('/gallery', async (req: Request, res: Response) => {
  const pq = parsePageQuery(req, { defaultPageSize: 50, maxPageSize: 200 });

  if (!pq.isPaginated) {
    try { res.json(await gallery.list()); }
    catch { res.json([]); }
    return;
  }

  // Optional media-type filter, applied globally before pagination so pages
  // match the sidebar state. `sort=oldest` reverses the default ComfyUI order
  // (which is newest-first). Favourites stay client-side (localStorage).
  const media = typeof req.query.mediaType === 'string' ? req.query.mediaType : '';
  const sort = typeof req.query.sort === 'string' && req.query.sort === 'oldest'
    ? 'oldest' : 'newest';

  try {
    const { items, total } = await gallery.listPaginated(
      { mediaType: media, sort }, pq.page, pq.pageSize,
    );
    const totalPages = total === 0 ? 1 : Math.ceil(total / pq.pageSize);
    const safePage = Math.min(Math.max(1, pq.page), totalPages);
    const start = (safePage - 1) * pq.pageSize;
    res.json({
      items,
      page: safePage,
      pageSize: pq.pageSize,
      total,
      hasMore: start + items.length < total,
    });
  } catch {
    res.json({ items: [], page: 1, pageSize: pq.pageSize, total: 0, hasMore: false });
  }
});

export default router;
