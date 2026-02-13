# MangoCT – Setup & Build

CT Segmentation Viewer: Next.js frontend + Python backend. Use from Terminal or as a macOS app (DMG).

---

## 1. Install prerequisites (one-time)

Install these if you don’t have them:

| Tool      | Purpose              | Install |
|-----------|----------------------|---------|
| **Node.js** | npm, frontend, Electron | [nodejs.org](https://nodejs.org/) (LTS) or `brew install node` |
| **Python 3** | Backend API          | [python.org](https://www.python.org/downloads/) (3.11+) or `brew install python` |

Check:

```bash
node -v    # e.g. v20.x
npm -v     # e.g. 10.x
python3 --version  # e.g. Python 3.11+
```

---

## 2. One-time setup (project root)

From the project folder:

```bash
cd /path/to/ct-viewer

npm install
python3 -m venv backend/.venv-packaging
backend/.venv-packaging/bin/python -m pip install -r backend/requirements.txt
backend/.venv-packaging/bin/python -m pip install pyinstaller
```

---

## 3. Run from Terminal

```bash
bash start.sh
```

Opens frontend at http://localhost:3000 and backend at http://localhost:8000. Press Ctrl+C to stop.

---

## 4. Run as desktop app (Electron)

With `start.sh` running in another terminal, or a dev server on port 3000:

```bash
npm run electron
```

---

## 5. Build the DMG (installer)

```bash
npm run dist
```

Outputs:

- `dist/MangoCT-1.0.0-arm64.dmg`
- `dist/MangoCT-1.0.0-arm64-mac.zip`

---

## 6. Sharing the app (unsigned)

The built app is **unsigned**. Recipients may see “file is damaged” or “Backend failed to start”.

**Fix for recipients:** In Terminal:

```bash
xattr -cr "/Applications/MangoCT.app"
```

Then open the app again.

---

## Partial rebuilds

| Change type    | Commands |
|----------------|----------|
| Installer only | `npm run build:app` |
| Frontend only | `npm run build:frontend` then `npm run build:app` |
| Backend only  | `npm run build:backend` then `npm run build:app` |
