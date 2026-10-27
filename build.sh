#!/usr/bin/env bash
# Exit on error
set -e

echo "=== Building Cipher Vault Room (Single-Service) ==="

# 1. Build Frontend
echo "--- Installing frontend dependencies and building production SPA bundle ---"
cd frontend
npm install --no-audit --no-fund
npm run build
cd ..

# 2. Build Backend
echo "--- Installing backend dependencies ---"
cd backend
python -m pip install --upgrade pip
pip install -r requirements.txt
cd ..

echo "=== Build completed successfully! ==="
