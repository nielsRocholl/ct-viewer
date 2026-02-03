#!/bin/bash
cd "$(dirname "$0")"

# Start backend + frontend in background if not already running
if ! lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1 || ! lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
  ./start.sh &
  START_PID=$!
  echo "Starting backend and frontend..."
  for i in {1..60}; do
    if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1 && lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

# Open the Electron app (dev mode)
npm run electron
