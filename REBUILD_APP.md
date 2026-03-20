# MangoCT – Setup & Build

CT Segmentation Viewer: Next.js frontend + Python backend. Use from Terminal or as a macOS app (DMG).

This project ships a static Next.js frontend and a bundled Python backend. The app is built unsigned for macOS distribution without an Apple Developer account.

## Build from source (no Gatekeeper issues)

If you clone the repo and build the app yourself, the resulting app was created locally—not downloaded from the internet—so macOS will not add quarantine attributes. **No right-click → Open or xattr workaround needed.**

### One-command install (no prerequisites)

From a fresh clone, run:

```bash
git clone https://github.com/YOUR_ORG/3D-CT-Viewer   # replace with your repo URL
cd 3D-CT-Viewer
./install-and-build.sh
```

This script installs Homebrew (if missing), Node.js, and Python via Homebrew, then runs the full build. You may be prompted for your password when Homebrew installs. Output: `dist/MangoCT-1.0.0-arm64.dmg`.

### Manual setup

If you prefer to install prerequisites yourself, follow the steps below.

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

- Packaged app runs a bundled backend on `127.0.0.1:8000`.
- Backend logs: `~/Library/Application Support/MangoCT/backend.log`

### Sharing the app with others

The app is **unsigned**. Provide these exact steps to recipients (works on macOS Ventura+, tested up to Sequoia):

1. Double-click the `.dmg` to mount it.
2. Drag the app icon to `/Applications`.
3. **Do not double-click the app yet.** Right-click (or Ctrl-click) the app in `/Applications` → select **Open**.
4. Click **Open** in the Gatekeeper dialog.

The app now runs normally—no more dialogs on future launches.

**If downloads add quarantine attributes** (common from browsers/email), run this once in Terminal after dragging to Applications:

```bash
xattr -r -d com.apple.quarantine /Applications/MangoCT.app
```

Then open the app again.

**For zero-friction distribution:** Sign and notarize with an Apple Developer ID ($99/year).

---

## Partial rebuilds

| Change type    | Commands |
|----------------|----------|
| Installer only | `npm run build:app` |
| Frontend only | `npm run build:frontend` then `npm run build:app` |
| Backend only  | `npm run build:backend` then `npm run build:app` |
