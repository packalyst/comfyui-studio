// Model catalog routes. The merged view is the single source of truth the UI
// consumes; the refresh endpoint is used as a just-in-time size-lookup trigger
// before the frontend shows a download progress bar.

import { Router, type Request, type Response } from 'express';
import * as catalog from '../services/catalog.js';
import { parsePageQuery, paginate } from '../lib/pagination.js';

const router = Router();

// Merged view: catalog + launcher disk scan joined with install state.
//
// When `?page=` is absent, returns the full flat array (legacy shape).
// When `?page=` is present, applies optional `?q=` / `?type=` / `?installed=`
// filters globally BEFORE slicing so pagination lines up with user intent.
router.get('/models/catalog', async (req: Request, res: Response) => {
  const all = await catalog.getMergedModels();
  const pq = parsePageQuery(req, { defaultPageSize: 100, maxPageSize: 500 });
  if (!pq.isPaginated) { res.json(all); return; }

  const q = typeof req.query.q === 'string' ? req.query.q.toLowerCase().trim() : '';
  const typeFilter = typeof req.query.type === 'string' && req.query.type
    ? new Set(req.query.type.split(',').map((s) => s.trim()).filter(Boolean))
    : null;
  const installedParam = typeof req.query.installed === 'string' ? req.query.installed : '';
  let rows = all;
  if (installedParam === 'true') rows = rows.filter((m) => m.installed);
  else if (installedParam === 'false') rows = rows.filter((m) => !m.installed);
  if (typeFilter && typeFilter.size > 0) {
    rows = rows.filter((m) => typeFilter.has(m.type || 'other'));
  }
  if (q) {
    rows = rows.filter((m) =>
      (m.name || '').toLowerCase().includes(q) ||
      (m.filename || '').toLowerCase().includes(q) ||
      (m.type || '').toLowerCase().includes(q),
    );
  }

  res.json(paginate(rows, pq.page, pq.pageSize));
});

// Force-refresh size info for a specific model (or many). Used when the user
// clicks Download so the size is fresh before the progress bar appears.
router.post('/models/catalog/refresh-size', async (req: Request, res: Response) => {
  const { filename, filenames } = (req.body || {}) as {
    filename?: string;
    filenames?: string[];
  };
  await catalog.seedFromComfyUI();
  if (filename) {
    const m = await catalog.refreshSize(filename, { force: true });
    res.json(m);
    return;
  }
  if (Array.isArray(filenames)) {
    await catalog.refreshMany(filenames, { force: true, concurrency: 8 });
    res.json({ ok: true });
    return;
  }
  res.status(400).json({ error: 'provide `filename` or `filenames`' });
});

export default router;
