#!/bin/sh
set -e
export NODE_ENV=development
cd /studio
echo "Installing frontend deps..."
NODE_ENV=development npm install --include=dev
ls -la node_modules/vite/bin/ || echo "vite NOT INSTALLED"
cd /studio/server
echo "Installing backend deps..."
NODE_ENV=development npm install --include=dev
cd /studio/server
echo "Starting backend..."
BACKEND_PORT=3002 PORT=3002 NODE_ENV=development npx tsx watch src/index.ts &
BACKEND_PID=$!
cd /studio
echo "Backend started (pid $BACKEND_PID)"
sleep 2
echo "Starting vite dev server on 3001..."
exec npx vite --host 0.0.0.0 --port 3001 --clearScreen false
