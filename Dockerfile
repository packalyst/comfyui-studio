# syntax=docker/dockerfile:1.6
#
# ComfyUI Studio — extends the upstream beclab image with OUR launcher and OUR UI.
#
# Two final targets:
#   prod (default) — compiled JS, runtime deps only, static frontend bundle. Small & fast.
#   dev            — source + dev deps included, ready for tsx watch + vite --host.
#
# Pick which to build with `--target prod` or `--target dev`.

ARG BASE_IMAGE=docker.io/beclab/comfyui:v0.18.2-fe1.43.4-launcher0.2.36

# ======================================================================
# Stage: frontend-build — throwaway; we only need its dist/.
# ======================================================================
FROM ${BASE_IMAGE} AS frontend-build
WORKDIR /build/studio
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json vite.config.ts tailwind.config.js postcss.config.js index.html ./
COPY src ./src
RUN npm run build


# ======================================================================
# Stage: launcher-build — compile TS → dist, prune dev deps.
# ======================================================================
FROM ${BASE_IMAGE} AS launcher-build
WORKDIR /build/launcher
COPY launcher-backend/package.json launcher-backend/package-lock.json ./
RUN npm ci --include=dev
COPY launcher-backend/tsconfig.json ./
COPY launcher-backend/src ./src
RUN npm run build
RUN npm prune --omit=dev


# ======================================================================
# Stage: studio-server-build — compile TS → dist, prune dev deps.
# `nodejs24-devel` is required because `better-sqlite3` is a native C++
# addon and civitai does not yet publish prebuilt binaries for Node 24 —
# `npm ci` falls back to building from source via node-gyp, which needs
# the headers at `/usr/include/node24/common.gypi`.
# ======================================================================
FROM ${BASE_IMAGE} AS studio-server-build
RUN zypper --non-interactive --no-refresh install -y nodejs24-devel \
  && zypper clean -a
WORKDIR /build/studio-server
COPY server/package.json server/package-lock.json ./
RUN npm ci --include=dev
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build
RUN npm prune --omit=dev


# ======================================================================
# Stage: prod — compiled code only, smallest final image.
# ======================================================================
FROM ${BASE_IMAGE} AS prod

# Drop the baked-in launcher & its old SPA. ComfyUI's own editor frontend is kept.
RUN rm -rf /app/server /app/dist/spa

# Launcher (port 3000)
COPY --from=launcher-build /build/launcher/dist          /app/server/dist
COPY --from=launcher-build /build/launcher/node_modules  /app/server/node_modules
COPY launcher-backend/package.json                        /app/server/package.json

# Studio backend (port 3002)
COPY --from=studio-server-build /build/studio-server/dist          /studio/server/dist
COPY --from=studio-server-build /build/studio-server/node_modules  /studio/server/node_modules
COPY server/package.json                                            /studio/server/package.json

# Studio frontend (static bundle, served by the backend)
COPY --from=frontend-build /build/studio/dist  /studio/dist

# Entrypoint
COPY docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 3000 3002 8188
ENV STUDIO_MODE=prod \
    COMFYUI_URL=http://localhost:8188 \
    LAUNCHER_URL=http://localhost:3000
CMD ["/app/start.sh"]


# ======================================================================
# Stage: dev — source + dev deps + tsx + vite, ready for hot-reload.
#   Intended to be run with `STUDIO_MODE=dev`, optionally with host source
#   bind-mounted over /studio and /app/server to live-edit from your laptop.
#   `nodejs24-devel` is kept around so an in-pod `npm rebuild` (triggered
#   when the hostPath-mounted node_modules mismatches the container arch)
#   can rebuild `better-sqlite3` without failing on missing headers.
# ======================================================================
FROM ${BASE_IMAGE} AS dev
RUN zypper --non-interactive --no-refresh install -y nodejs24-devel \
  && zypper clean -a

# Drop the baked-in launcher & old SPA.
RUN rm -rf /app/server /app/dist/spa

# --- Launcher source + full (dev) deps ---
WORKDIR /app/server
COPY launcher-backend/package.json launcher-backend/package-lock.json ./
RUN npm ci --include=dev
COPY launcher-backend/tsconfig.json ./
COPY launcher-backend/src ./src

# --- Studio frontend source + full deps (needed for vite dev + vite build) ---
WORKDIR /studio
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY tsconfig.json vite.config.ts tailwind.config.js postcss.config.js index.html ./
COPY src ./src
# COPY public ./public   # uncomment if/when a public/ folder is added

# --- Studio backend source + full deps ---
WORKDIR /studio/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --include=dev
COPY server/tsconfig.json ./
COPY server/src ./src

# Entrypoint (same script, runs the dev branch when STUDIO_MODE=dev)
COPY docker/start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 3000 3001 3002 8188
ENV STUDIO_MODE=dev \
    COMFYUI_URL=http://localhost:8188 \
    LAUNCHER_URL=http://localhost:3000
CMD ["/app/start.sh"]
