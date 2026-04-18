# ComfyUI Studio

A web frontend + model/ComfyUI manager bundled into a single container, extending
the upstream `beclab/comfyui` image.

## Layout

```
src/                 # studio frontend (Vite + React)
server/              # studio backend (Express, WebSocket, proxies)
launcher-backend/    # launcher (Koa) — model downloads, ComfyUI lifecycle
docker/              # container entrypoint
.github/workflows/   # image build + push (GHCR)
Dockerfile           # extend beclab image with our launcher + studio
.local/              # scratch / reference (gitignored)
```

## Dev

Mount this folder into the pod's studio container and run with `STUDIO_MODE=dev`;
the container runs `tsx watch` + `vite --host` against the mounted source so edits
hot-reload. (This is the current pod setup.)

## Build image

On push to `main`, the GitHub Actions workflow builds **two images in parallel**
and pushes them to GHCR:

| Tag                                      | Target | Contents                                      | Use for              |
|------------------------------------------|--------|-----------------------------------------------|----------------------|
| `ghcr.io/<owner>/<repo>:<sha>`           | prod   | Compiled JS + static frontend, no dev deps    | Production pods      |
| `ghcr.io/<owner>/<repo>:latest`          | prod   | Same as above, always newest                  | Production pods      |
| `ghcr.io/<owner>/<repo>:<sha>-dev`       | dev    | Source + full deps + tsx + vite inside        | Hot-reload dev pods  |
| `ghcr.io/<owner>/<repo>:latest-dev`      | dev    | Same as above, always newest                  | Hot-reload dev pods  |

The dev image is meant to be launched with `STUDIO_MODE=dev`. Source can be
bind-mounted over `/studio` and `/app/server` to live-edit from the host; if
nothing is mounted, the image's own baked-in source runs.

Manual build of a specific target:
```bash
docker build --target prod -t ghcr.io/<you>/comfyui-studio:dev .
docker build --target dev  -t ghcr.io/<you>/comfyui-studio:dev-dev .
```

## Deploy new tag

```bash
kubectl set image -n user-space-admin deployment/comfyuistudio \
  comfyui=ghcr.io/<you>/comfyui-studio:<sha>
```

## Ports

| Port | Service              |
|------|----------------------|
| 3000 | Launcher (our code)  |
| 3002 | Studio backend + serves the built frontend |
| 8188 | ComfyUI              |

ComfyUI's own editor frontend (the node-graph canvas) still lives inside the
base image and is reachable via the "Open Editor" button on the Dashboard.
