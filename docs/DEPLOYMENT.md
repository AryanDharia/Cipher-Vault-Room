# VaultRoom Deployment & Production Operations Guide

This guide details requirements and procedures for deploying VaultRoom to secure hosting environments.

---

## 1. Production Architecture Overview

- **Frontend**: Static React single-page application served via Cloudflare Pages, Vercel, AWS S3/CloudFront, or Nginx.
- **Backend**: FastAPI ASGI service served with `uvicorn` behind an SSL termination reverse proxy (Nginx, Traefik, or AWS ALB) with WebSocket forwarding.
- **Database**: Managed PostgreSQL with TLS enforcement.

---

## 2. Environment Variables Checklist

Set these values in your production environment (e.g. systemd service, Docker Compose, or cloud secrets manager):

| Variable | Description | Production Recommendation |
|---|---|---|
| `ENVIRONMENT` | Runtime environment | `production` |
| `HOST` | Backend bind address | `0.0.0.0` |
| `PORT` | Backend listen port | `8000` |
| `JWT_SECRET_KEY` | 256-bit secret for signing access tokens | Minimum 64-character random hex string |
| `DATABASE_URL` | SQLAlchemy async connection string | `postgresql+asyncpg://user:pass@host:5432/vaultroom` |
| `CORS_ORIGINS` | Allowed frontend origins | Exact production domain (e.g. `https://vault.company.com`) |
| `ROOM_CODE_EXPIRY_HOURS` | Lifetime for inactive room codes | `24` |
| `ANOMALY_DETECTION_MODE` | Guard mode | `hybrid` or `real_baseline` |

---

## 3. Reverse Proxy & WebSocket Configuration (Nginx Example)

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
