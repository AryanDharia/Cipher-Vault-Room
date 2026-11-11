#!/usr/bin/env bash
# Exit on error
set -e

echo "=== Building VaultRoom Backend (API & WebSocket Service) ==="
echo "Python: $(python --version 2>&1 || echo 'Python not found')"

# -------------------------------------------------------------
# Install Backend Dependencies Only
# The VaultRoom web frontend is hosted separately on Cloudflare Pages.
# -------------------------------------------------------------
echo "--- Installing backend dependencies ---"
cd backend
python -m pip install --upgrade pip
pip install -r requirements.txt
cd ..

echo "=== Backend build completed successfully! ==="
