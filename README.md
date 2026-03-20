# CT Segmentation Viewer

A high-reliability, web-based CT viewer for dataset inspection and segmentation quality assessment.

## Features

- Load and visualize 3D CT volumes and segmentation masks
- Support for multiple file formats (.nii, .nii.gz, .mha, .mhd)
- Compare up to 10 CT-segmentation pairs simultaneously
- Synchronized navigation across multiple viewer panels (physical-space coordinates)
- Adjustable window/level, zoom, and pan controls
- Customizable segmentation overlay colors and opacity
- Boundary-only visualization mode for edge assessment
- Toast notifications (Sonner) for success, error, and loading feedback

## Technology Stack

**Frontend:** Next.js 14 (App Router), React 18, TypeScript, TanStack Query, Zustand, Tailwind CSS, shadcn/ui, next-themes, Sonner

**Backend:** FastAPI (Python 3.11+), SimpleITK, NumPy, Uvicorn, Pillow

## Getting Started

### Prerequisites

- **Docker:** Docker and Docker Compose (for containerized run)
- **Local:** Node.js 18+ and Python 3.11+ (for local development)

### Option A – Docker

```bash
docker-compose up --build
```

- Frontend: http://localhost:3000
- Backend: http://localhost:8000
- API docs: http://localhost:8000/docs

### Option B – Local

1. One-time setup:

```bash
./setup.sh
```

(Creates backend venv, installs backend and frontend dependencies, copies `.env.example` / `.env.local.example`.)

2. Start the app:

```bash
./start.sh
```

Use `./stop.sh` to stop all services. Or run manually: backend `cd backend && source venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8000`; frontend `cd frontend && npm run dev`.

### Option C – Desktop app (Electron, native folder picker)

1. Do **Option B** setup (one-time), then either use the **Dock app** or run Electron manually:

**Add to MacBook Dock (recommended)**  
- In Finder, open the project folder and find **CT Viewer.app**.
- Drag **CT Viewer.app** to the Dock (e.g. next to Finder).
- Click the Dock icon to start: it will start backend and frontend if needed, then open the Electron window. No Terminal required.

**Or run from terminal:**  
From the project root, after `./start.sh` is running in another terminal:

```bash
npm install
npm run electron
```

The Electron window uses the **native macOS folder picker** when you choose "Load Dataset" in the sidebar.

## Scripts

| Script      | Purpose                          | Usage      |
|------------|-----------------------------------|------------|
| `setup.sh` | One-time setup (venv, deps, env)  | `./setup.sh` |
| `start.sh` | Start backend and frontend        | `./start.sh` |
| `stop.sh`  | Stop all services                 | `./stop.sh`  |
| `npm run electron` | Open desktop window (run after `./start.sh`) | From project root |
| **CT Viewer.app** | One-click launcher (starts services + Electron) | Drag to Dock; click to open |

Logs: `backend.log`, `frontend.log` (when using `start.sh`).

## Project Structure

```
.
├── backend/
│   ├── services/           # Volume loader, slice extractor, geometry validator, cache, resampler
│   ├── main.py             # FastAPI app
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── app/                # Next.js App Router (layout, page, test-* pages)
│   ├── components/         # Viewer grid, viewer panel, canvas renderer, file upload dialog, global controls
│   ├── lib/                # API client (api-client, api-hooks, api-types), synchronization, store
│   ├── package.json
│   └── Dockerfile
└── docker-compose.yml
```

Key components: **ViewerGrid** (grid of panels), **ViewerPanel** (W/L, zoom, pan, overlay, colors), **CanvasRenderer** (CT + overlay), **FileUploadDialog** (drag-drop, progress, geometry validation), **GlobalControls** (sync, reset, upload).

## Environment Variables

**Backend (`.env` in `backend/`):**

- `MAX_CACHE_SIZE_MB` – LRU memory budget for **cached CT/segmentation PNG slices** (default: 4096). Evicts least-recently-used slice PNGs when full; full 3D volumes remain in memory until unload.
- `SLICE_PNG_CACHE` – Enable slice PNG LRU (`1`/`true`, default); set `0`/`false` to disable caching.
- `SLICE_PNG_COMPRESS_LEVEL` – Pillow PNG compression 0–9 (default `3`); lower = faster encoding, larger PNGs.
- `MAX_FILE_SIZE_MB` – Upload size limit (default: 2048)
- `LOG_LEVEL` – DEBUG, INFO, WARNING, ERROR (default: INFO). Logs go to stdout and `backend.log`.
- `DEBUG` – If set, error responses include full exception detail.

**Frontend (`.env.local` in `frontend/`):**

- `NEXT_PUBLIC_API_URL` – Backend URL (default: http://localhost:8000)
- `NEXT_PUBLIC_SLICE_FETCH_CONCURRENCY` – Max parallel CT/segmentation slice fetches (default: 12). Lower if scrolling still stutters on a slow Mac; raise on a fast machine with many masks.

## API Overview

- **Health:** `GET /health`
- **Volumes:** `POST /api/volumes/upload`, `GET /api/volumes/{id}/metadata`, `DELETE /api/volumes/{id}`
- **Pairs:** `POST /api/pairs`, `GET /api/pairs/{id}`, `DELETE /api/pairs/{id}`
- **Slices:** `GET /api/slices/ct/{id}`, `GET /api/slices/segmentation/{id}` (query: slice_index, orientation, window_level, window_width, mode)
- **Sync helpers:** `POST /api/pairs/{id}/index-to-physical`, `POST /api/pairs/{id}/physical-to-index`

Full API: http://localhost:8000/docs

## Testing

**Backend:**

```bash
cd backend && source venv/bin/activate && pytest -v
```

**Frontend:**

```bash
cd frontend && npm test
```

## Troubleshooting

- **Ports 3000 or 8000 in use:** Run `./stop.sh` or `lsof -ti:8000 | xargs kill -9` / `lsof -ti:3000 | xargs kill -9`.
- **Backend fails:** Ensure Python 3.11+, venv activated (`source venv/bin/activate`), deps installed (`pip install -r requirements.txt`). Check `backend.log`.
- **Frontend fails:** Ensure Node 18+, run `npm install` in `frontend/`. Clear cache: `rm -rf frontend/.next`. Check `frontend.log`.
- **SimpleITK install issues:** `pip install --upgrade pip && pip install SimpleITK` inside backend venv.

## Building for Production

**Standalone macOS app (DMG):** See [REBUILD_APP.md](REBUILD_APP.md). Clone the repo, run the one-time setup, then `npm run dist`. Building locally avoids Gatekeeper quarantine issues.

**Docker:**
- Backend: `docker build -t ct-viewer-backend backend/`
- Frontend: `cd frontend && npm run build && docker build -t ct-viewer-frontend .`

## Code Style

- Backend: PEP 8, type hints, small focused functions.
- Frontend: TypeScript strict, functional components and hooks.

## Contributing

Branch, make changes, run tests, open a PR.

## License

MIT
