# Rebuild macOS App (Unsigned)

This project ships a static Next.js frontend and a bundled Python backend.

## Prerequisites

- **Node.js** (for npm, frontend, Electron)
- **Python 3** (for backend)
- **macOS** (Apple Silicon recommended; build targets arm64)

## One-time setup

From the project root:

```bash
# 1. Install Node dependencies
npm install

# 2. Create Python virtual environment for packaging
python3 -m venv backend/.venv-packaging

# 3. Install backend dependencies and PyInstaller
backend/.venv-packaging/bin/python -m pip install -r backend/requirements.txt
backend/.venv-packaging/bin/python -m pip install pyinstaller
```

## Build the DMG

```bash
npm run dist
```

Outputs:

- `dist/MangoCT-1.0.0-arm64.dmg`
- `dist/MangoCT-1.0.0-arm64-mac.zip`

## Partial rebuilds

| Change type      | Commands                                      |
|------------------|-----------------------------------------------|
| Installer only   | `npm run build:app`                           |
| Frontend only    | `npm run build:frontend` then `npm run build:app` |
| Backend only     | `npm run build:backend` then `npm run build:app` |

## Notes

- Packaged app runs a bundled backend on `127.0.0.1:8000`.
- Backend logs: `~/Library/Application Support/MangoCT/backend.log`

## Sharing the app with others

The app is **unsigned**. Recipients may see "file is damaged" or "Backend failed to start" when opening it.

**Workaround for recipients:** In Terminal run:

```bash
xattr -cr "/Applications/MangoCT.app"
```

Then open the app again.

**Proper fix:** Sign and notarize with an Apple Developer ID ($99/year).
