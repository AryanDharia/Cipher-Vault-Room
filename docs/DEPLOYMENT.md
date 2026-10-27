# VaultRoom / Cipher Vault Room Deployment Guide

This guide details requirements and procedures for deploying Cipher Vault Room as a **single-service Web Service on Render** (ONE public URL and ONE Web Service serving both frontend and backend) or on custom server infrastructure.

---

## 1. Single-Service Architecture on Render

Cipher Vault Room is built with a unified single-service architecture:
- **Unified Origin**: FastAPI serves both the REST API (`/api/`), real-time WebSockets (`/ws/`), and the built React/TipTap single-page application (`index.html`, `/assets/`, with SPA catch-all routing).
- **Zero Insecure Cross-Origin Issues**: Because frontend and backend live under the exact same domain, cookies, authentication headers, and WebSocket connections (`wss://`) connect seamlessly without CORS or mixed-content hurdles.
- **Database**: PostgreSQL on Render (managed) or SQLite for local development.

---

## 2. Deploy to Render (Step-by-Step)

### Option A: Automated via Render Blueprint (`render.yaml`)

1. Push this repository to GitHub (`AryanDharia/Cipher-Vault-Room`).
2. Log in to [Render Dashboard](https://dashboard.render.com).
3. Click **New +** -> **Blueprint**.
4. Connect the `Cipher-Vault-Room` repository.
5. Render reads `render.yaml` and provisions:
   - **Web Service**: `cipher-vault-room` (Python runtime, running `./build.sh` and `uvicorn`).
   - **PostgreSQL Database**: `cipher-vault-postgres` (auto-wires `DATABASE_URL` with SSL).
6. Click **Apply**. Deployment will build the React SPA, install Python packages, initialize database tables, and go live on your single Render `.onrender.com` URL.

### Option B: Manual Web Service Setup on Render

If creating the Web Service manually:

1. Click **New +** -> **Web Service**.
2. Connect your `Cipher-Vault-Room` repository.
3. Configure the following settings:
   - **Name**: `cipher-vault-room`
   - **Runtime**: `Python 3`
   - **Branch**: `main`
   - **Build Command**: `./build.sh`
   - **Start Command**: `cd backend && python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Health Check Path**: `/api/health`
4. Add Environment Variables:
   | Key | Value | Notes |
   |---|---|---|
   | `PYTHON_VERSION` | `3.11.9` | Ensures Python 3.11+ |
   | `NODE_VERSION` | `20.11.0` | Enables Node 20 for Vite build |
   | `ENVIRONMENT` | `production` | Enables production mode |
   | `JWT_SECRET_KEY` | `<generate random 64-char hex>` | Token signing key |
   | `DATABASE_URL` | `<internal connection string>` | Render PostgreSQL connection string |
5. Click **Deploy Web Service**.

---

## 3. How the Build & Runtime Works

1. **`build.sh`**:
   - Runs `npm install` and `npm run build` in `/frontend`, compiling the React app to `/frontend/dist`.
   - Runs `pip install -r requirements.txt` in `/backend`, installing FastAPI, uvicorn, SQLAlchemy, asyncpg, Argon2id, and dependencies.
2. **`app/main.py`**:
   - Automatically detects Render's `$PORT` and binds to `0.0.0.0`.
   - Mounts `/assets` from `/frontend/dist/assets`.
   - Handles SPA catch-all routing (`/{full_path:path}`) returning `index.html` for deep links (e.g. `/rooms/ABC123`).
   - Translates `postgres://` URLs into SQLAlchemy's async driver `postgresql+asyncpg://`.
   - Calls `init_db()` on startup to create all database tables automatically.
3. **Health Check**:
   - `/api/health` returns HTTP 200 with service status, active rooms count, and zero-knowledge enforcement flag.

---

## 4. Reverse Proxy & WebSocket Configuration (Nginx Alternative)

```nginx
server {
    listen 443 ssl http2;
    server_name vault.company.com;

    ssl_certificate /etc/letsencrypt/live/vault.company.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/vault.company.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # Frontend Static Files
    location / {
        root /var/www/vaultroom/frontend/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend REST API
    location /api/ {
        proxy_pass http://127.0.0.1:8000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket Real-Time Synchronization
    location /ws/ {
        proxy_pass http://127.0.0.1:8000/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

---

## 4. Multi-Instance Scalability Note

In the default single-server deployment, room states and active WebSocket connections are managed in memory by `RoomConnectionManager` with DB persistence. For multi-server horizontal scaling across multiple instances, deploy a Redis Pub/Sub adapter to broadcast encrypted deltas across backend nodes without sharing decryption keys.
