#!/bin/bash
set -e

cd "$(dirname "$0")"
PROJECT_ROOT="$(pwd)"

echo "=== MangoCT: One-command install and build ==="
echo ""

# macOS check
if [[ "$(uname)" != "Darwin" ]]; then
  echo "Error: This script is for macOS only."
  exit 1
fi

# Homebrew
install_brew() {
  if command -v brew &>/dev/null; then
    echo "✓ Homebrew found"
  else
    echo "Installing Homebrew (you may be prompted for your password)..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add brew to PATH (Apple Silicon: /opt/homebrew, Intel: /usr/local)
    for brew in /opt/homebrew/bin/brew /usr/local/bin/brew; do
      [[ -x "$brew" ]] && eval "$("$brew" shellenv)" && break
    done
  fi
  if ! command -v brew &>/dev/null; then
    echo "Error: Homebrew not found after install. Try opening a new Terminal and running this script again."
    exit 1
  fi
}

# Node.js
ensure_node() {
  if command -v node &>/dev/null && node -e "exit(0)" 2>/dev/null; then
    echo "✓ Node.js $(node -v) found"
    return 0
  fi
  echo "Installing Node.js..."
  brew install node
}

# Python 3
ensure_python() {
  if command -v python3 &>/dev/null && python3 -c "import sys; exit(0 if sys.version_info >= (3, 9) else 1)" 2>/dev/null; then
    echo "✓ Python $(python3 --version) found"
    return 0
  fi
  echo "Installing Python..."
  brew install python
  hash -r 2>/dev/null || true
}

# Main
echo "Step 1/4: Checking prerequisites..."
install_brew
ensure_node
ensure_python
echo ""

echo "Step 2/4: Installing Node dependencies..."
npm install
echo ""

echo "Step 3/4: Setting up Python packaging environment..."
python3 -m venv backend/.venv-packaging
backend/.venv-packaging/bin/python -m pip install -q -r backend/requirements.txt
backend/.venv-packaging/bin/python -m pip install -q pyinstaller
echo ""

echo "Step 4/4: Building app..."
npm run dist
echo ""

echo "=== Done! ==="
echo ""
echo "Output:"
echo "  dist/MangoCT-1.0.0-arm64.dmg"
echo "  dist/MangoCT-1.0.0-arm64-mac.zip"
echo ""
echo "Copy the .app from the DMG to Applications and run it (no Gatekeeper issues when built locally)."
