# Rebuild macOS App (Unsigned)

This project ships a static Next.js frontend and a bundled Python backend.

## One-time setup

1. Install root Node dependencies:
   - `npm install`
2. Create the packaging venv and install PyInstaller:
   - `python3 -m venv backend/.venv-packaging`
   - `backend/.venv-packaging/bin/python -m pip install pyinstaller`

## Full rebuild (frontend + backend + installer)

- `npm run dist`

Outputs:
- `dist/CT Segmentation Viewer-1.0.0-arm64.dmg`
- `dist/CT Segmentation Viewer-1.0.0-arm64-mac.zip`

## Rebuild only the installer (after frontend/backend already built)

- `npm run build:app`

## Frontend-only changes

1. `npm run build:frontend`
2. `npm run build:app`

## Backend-only changes

1. `npm run build:backend`
2. `npm run build:app`

## Notes

- Packaged app runs a bundled backend binary on `127.0.0.1:8000`.
- Static UI is served by a tiny local HTTP server inside Electron.
- Logs for the packaged backend:
  - `~/Library/Application Support/CT Segmentation Viewer/backend.log`
