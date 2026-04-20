#!/bin/bash
# ComfyUI Studio container entrypoint.
#
# - In prod (default) it runs pre-compiled JS from /app/server/dist and /studio/server/dist.
# - In dev (STUDIO_MODE=dev) it expects the source to be mounted into /app/server and
#   /studio (and /studio/server), and runs tsx watch + vite dev — matches how we iterate
#   locally today.
#
# ComfyUI itself is spawned by our launcher as a child process (via the launcher's
# ComfyUIController), so we do NOT start ComfyUI here.
set -e
mkdir -p /app/logs

# ComfyUI's /root/ComfyUI/.git dir is surfaced with host-side ownership via the
# hostPath mount, so git refuses to operate ("dubious ownership"). Trust it so
# ComfyUI-Manager's Update flow (git fetch/checkout via the pod's git) works.
git config --global --add safe.directory /root/ComfyUI 2>/dev/null || true
git config --global --add safe.directory '*' 2>/dev/null || true

if [ "${STUDIO_MODE}" = "dev" ]; then
  # Dev: the host mounts the source folders over these paths, so node_modules must exist.
  (cd /app/server      && [ -d node_modules ] || npm install --include=dev)
  (cd /studio          && [ -d node_modules ] || npm install)
  (cd /studio/server   && [ -d node_modules ] || npm install --include=dev)

  (cd /app/server      && npx tsx watch src/index.ts             > /app/logs/launcher.log  2>&1) &
  (cd /studio/server   && npx tsx watch src/index.ts             > /app/logs/studio.log    2>&1) &
  (cd /studio          && npx vite --host 0.0.0.0 --port 3001    > /app/logs/vite.log      2>&1) &
else
  # Prod: run the compiled code baked into the image.
  (cd /app/server      && node dist/index.js    > /app/logs/launcher.log  2>&1) &
  (cd /studio/server   && node dist/index.js    > /app/logs/studio.log    2>&1) &
  # Studio frontend is already static at /studio/dist — the studio backend serves it.
fi

# Stream everything into container stdout so `kubectl logs` shows it live.
tail -F /app/logs/*.log 2>/dev/null &

# If any supervised process dies, bail so Kubernetes restarts the pod.
wait -n
exit $?
