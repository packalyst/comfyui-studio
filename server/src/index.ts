import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import apiRouter from './routes/index.js';
import { getComfyUIUrl, getQueue, getGalleryItems } from './services/comfyui.js';
import * as galleryService from './services/gallery.service.js';
import { loadTemplatesFromComfyUI } from './services/templates/index.js';
import { wireTemplateEventHandlers } from './services/templates/eventSubscribers.js';
import { wireCatalogEventHandlers } from './services/catalog.events.js';
import { setDownloadBroadcaster, getAllDownloads } from './services/downloads.js';
import { getStatus as getLocalComfyUIStatus } from './services/comfyui/status.service.js';
import { startComfyUIProxy } from './services/comfyui/proxy.service.js';
import { env } from './config/env.js';
import { migrateLegacyPaths } from './config/migrateLegacyPaths.js';
import { requestLogger } from './middleware/logging.js';
import { errorHandler } from './middleware/errors.js';
import { logger } from './lib/logger.js';

// Phase-6 path consolidation: move runtime-written JSON out of the bundled
// data dir and into `~/.config/comfyui-studio/runtime/` so it survives image
// rebuilds. No-op once migrated.
migrateLegacyPaths();

const app = express();
const PORT = env.PORT;

// CORS: default allow-all matches pod-internal behavior. When CORS_ORIGIN is
// set (e.g. a public deployment), lock down to the declared origin(s).
const corsOrigins = env.CORS_ORIGIN
  ? env.CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean)
  : undefined;
app.use(cors(corsOrigins ? { origin: corsOrigins } : undefined));
app.use(express.json({ limit: '50mb' }));
app.use(requestLogger());

app.use('/api', apiRouter);

import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distPath = path.resolve(__dirname, '../../dist');
app.use(express.static(distPath));
app.get('*', (_req, res, next) => {
  if (_req.path.startsWith('/api') || _req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});

// Install the error handler LAST. Express picks up 4-arg middleware only
// when `next(err)` is called, so this catches anything routes throw.
app.use(errorHandler());

const server = createServer(app);

// WS origin guard. Unset WS_ORIGIN preserves the prior allow-all behavior for
// pod-internal setups. When set (comma-separated list), reject upgrades whose
// Origin header is missing or not on the list.
const wsOrigins = env.WS_ORIGIN
  ? new Set(env.WS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean))
  : null;
const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: wsOrigins
    ? (info: { origin: string }) => !!info.origin && wsOrigins.has(info.origin)
    : undefined,
});

// ---- Track connected clients for broadcast ----
const clients = new Set<WebSocket>();

function broadcast(message: object) {
  const data = JSON.stringify(message);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

// ---- Single ComfyUI status poller, broadcast on change ----
// Status is sourced from the local status service. The WS message type is
// kept as `launcher-status` for frontend back-compat (it still listens under
// that name). Shape: { running, pid, uptime, versions, gpuMode, ... }.
let lastLauncherStatus: unknown = null;
let lastLauncherStatusJson = '';

async function pollLauncherStatus() {
  let data: Record<string, unknown>;
  try {
    data = await getLocalComfyUIStatus() as unknown as Record<string, unknown>;
  } catch (err) {
    data = { reachable: false, error: String(err) };
  }
  const json = JSON.stringify(data);
  if (json !== lastLauncherStatusJson) {
    lastLauncherStatus = data;
    lastLauncherStatusJson = json;
    broadcast({ type: 'launcher-status', data });
  }
}

setInterval(pollLauncherStatus, 5000);
pollLauncherStatus();

// Hook up downloads service so it can broadcast progress to all WS clients.
setDownloadBroadcaster(broadcast);

// ---- Queue & gallery broadcasts ----
// Triggered by ComfyUI WS events. Debounced so bursts of messages (e.g. per-node
// 'executed') collapse into one broadcast.
let queueTimer: NodeJS.Timeout | null = null;
let galleryTimer: NodeJS.Timeout | null = null;

function scheduleQueueBroadcast() {
  if (queueTimer) return;
  queueTimer = setTimeout(async () => {
    queueTimer = null;
    try {
      const queue = await getQueue();
      broadcast({ type: 'queue', data: queue });
    } catch { /* ignore */ }
  }, 100);
}

function scheduleGalleryBroadcast() {
  if (galleryTimer) return;
  galleryTimer = setTimeout(async () => {
    galleryTimer = null;
    try {
      // Persist new generations to sqlite in the same path that drives the
      // WS broadcast so the next /gallery fetch reads hot data.
      await galleryService.onGenerationComplete();
      const items = await getGalleryItems();
      broadcast({ type: 'gallery', data: { total: items.length, recent: items.slice(0, 8) } });
    } catch { /* ignore */ }
  }, 500);
}

// ---- Client WS: survives ComfyUI outages, retries upstream automatically ----
wss.on('connection', (clientWs) => {
  clients.add(clientWs);

  if (lastLauncherStatus !== null) {
    clientWs.send(JSON.stringify({ type: 'launcher-status', data: lastLauncherStatus }));
  }
  // Hydrate in-progress downloads so a freshly-loaded page sees them instantly.
  const snapshot = getAllDownloads();
  if (snapshot.length > 0) {
    clientWs.send(JSON.stringify({ type: 'downloads-snapshot', data: snapshot }));
  }

  let comfyWs: WebSocket | null = null;
  let comfyRetryTimer: NodeJS.Timeout | null = null;
  let closed = false;

  const openComfyWs = () => {
    if (closed) return;
    const comfyUrl = getComfyUIUrl().replace(/^http/, 'ws');
    try {
      comfyWs = new WebSocket(`${comfyUrl}/ws?clientId=${crypto.randomUUID()}`);
      comfyWs.on('message', (data) => {
        const str = data.toString();
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(str);
        // Trigger queue/gallery rebroadcast on relevant comfy events
        try {
          const msg = JSON.parse(str);
          if (msg?.type === 'status') scheduleQueueBroadcast();
          else if (msg?.type === 'executed' || msg?.type === 'execution_complete') {
            scheduleQueueBroadcast();
            scheduleGalleryBroadcast();
          }
        } catch { /* non-JSON */ }
      });
      comfyWs.on('error', () => { /* silent — close handler retries */ });
      comfyWs.on('close', () => {
        comfyWs = null;
        if (!closed) comfyRetryTimer = setTimeout(openComfyWs, 5000);
      });
    } catch {
      if (!closed) comfyRetryTimer = setTimeout(openComfyWs, 5000);
    }
  };

  openComfyWs();

  const cleanup = () => {
    closed = true;
    clients.delete(clientWs);
    if (comfyRetryTimer) clearTimeout(comfyRetryTimer);
    comfyWs?.close();
  };

  clientWs.on('close', cleanup);
  clientWs.on('error', cleanup);
});

async function start() {
  const comfyUrl = getComfyUIUrl();
  logger.info(`ComfyUI URL: ${comfyUrl}`);

  // Subscribe the templates repo to model/plugin lifecycle events so the
  // `installed` readiness flag stays in sync with disk state.
  wireTemplateEventHandlers();
  // Subscribe the catalog store to the same model-lifecycle events so
  // pre-populated rows flip from `downloading: true` to installed/error as
  // the download finishes.
  wireCatalogEventHandlers();

  server.listen(PORT, () => {
    logger.info(`ComfyUI Studio server running on port ${PORT}`);
  });

  // Start the ComfyUI reverse proxy on env.COMFYUI_PROXY_PORT so the native
  // frontend remains reachable even when ComfyUI itself is restarting. The
  // helper never throws and returns null when the proxy is disabled.
  try {
    startComfyUIProxy();
  } catch (err) {
    logger.error('failed to start comfyui proxy', { error: String(err) });
  }

  async function loadWithRetry(retries: number, delay: number) {
    await loadTemplatesFromComfyUI(comfyUrl);
    const tmpl = await import('./services/templates/index.js');
    if (tmpl.getTemplates().length === 0 && retries > 0) {
      logger.info(`Templates not available, retrying in ${delay / 1000}s... (${retries} retries left)`);
      setTimeout(() => loadWithRetry(retries - 1, delay), delay);
      return;
    }
    if (tmpl.getTemplates().length > 0) {
      // Seed sqlite with the shorthand edges + kick off deep refresh in the
      // background so real filenames populate without a manual click.
      tmpl.seedTemplatesOnce();
      tmpl.refreshTemplates().then(r => {
        logger.info('auto template refresh complete', r);
      }).catch(err => {
        logger.warn('auto template refresh failed', { error: String(err) });
      });
    }
  }
  loadWithRetry(12, 10000);
}

start().catch((err) => logger.error('server failed to start', { error: String(err) }));
