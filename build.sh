#!/usr/bin/env bash
# Exit on error
set -e

echo "=== Building Cipher Vault Room (Single-Service) ==="

# -------------------------------------------------------------
# Node.js Version Management for Frontend Build
# Vite 8 / Rolldown requires Node.js >= 20.12.0 (node:util.styleText)
# We guarantee Node 22 LTS (22.16.0) is active.
# -------------------------------------------------------------
TARGET_NODE_VERSION="${NODE_VERSION:-22.16.0}"

# If NODE_VERSION was set to 20.11.0 in Render dashboard env vars, override it to 22.16.0
if [ "$NODE_VERSION" = "20.11.0" ]; then
    echo "Notice: Overriding legacy NODE_VERSION=20.11.0 to 22.16.0"
    TARGET_NODE_VERSION="22.16.0"
fi

# 1. Try loading NVM if present on Render build machine
export NVM_DIR="$HOME/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
    echo "--- Sourcing NVM and setting Node version to ${TARGET_NODE_VERSION} ---"
    # shellcheck disable=SC1090
    \. "$NVM_DIR/nvm.sh"
    nvm install "$TARGET_NODE_VERSION" || true
    nvm use "$TARGET_NODE_VERSION" || true
fi

# 2. Verify whether active node has `node:util.styleText`
if ! node -e "require('node:util').styleText" 2>/dev/null; then
    echo "Notice: Active Node ($(node -v 2>/dev/null || echo 'none')) does not support styleText. Installing Node.js ${TARGET_NODE_VERSION}..."
    mkdir -p /tmp/node22
    ARCH="x64"
    if [ "$(uname -m)" = "aarch64" ] || [ "$(uname -m)" = "arm64" ]; then
        ARCH="arm64"
    fi
    curl -fsSL "https://nodejs.org/dist/v${TARGET_NODE_VERSION}/node-v${TARGET_NODE_VERSION}-linux-${ARCH}.tar.gz" | tar -xz -C /tmp/node22 --strip-components=1
    export PATH="/tmp/node22/bin:$PATH"
fi

echo "--- Active Environment Versions ---"
echo "Node.js: $(node -v)"
echo "NPM:     $(npm -v)"
echo "Python:  $(python --version 2>&1 || echo 'Python not found')"

# -------------------------------------------------------------
# 1. Build Frontend
# -------------------------------------------------------------
echo "--- Installing frontend dependencies and building production SPA bundle ---"
cd frontend
npm install --no-audit --no-fund
npm run build
cd ..

# -------------------------------------------------------------
# 2. Build Backend
# -------------------------------------------------------------
echo "--- Installing backend dependencies ---"
cd backend
python -m pip install --upgrade pip
pip install -r requirements.txt
cd ..

echo "=== Build completed successfully! ==="
