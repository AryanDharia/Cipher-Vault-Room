# Cloudflare frontend deployment plan

## Deployment architecture

Deploy only the existing React/Vite static frontend to Cloudflare Pages. Keep the existing FastAPI application, PostgreSQL database, and room WebSocket service on their current Render deployment. This is a split-origin deployment of the same application, not a standalone Cloudflare version: sign-in, room APIs, encrypted document persistence, and live collaboration continue to require the Render backend and its existing database.

The frontend already supports this topology. `VITE_API_URL` selects the REST API base URL and `VITE_WS_URL` selects the WebSocket origin. The WebSocket client appends `/ws/{room_code}` and passes the existing authorization token. The Tauri client continues using its configured Render backend URL and is unaffected by Pages hosting.

Do not migrate FastAPI or PostgreSQL as part of this frontend setup. A future Python Worker migration would require a separate compatibility project. Cloudflare now documents FastAPI through its Python Workers ASGI adapter, and Hyperdrive supports `asyncpg`, but this repository currently uses **async SQLAlchemy** throughout its routes/session layer. Cloudflare currently documents async SQLAlchemy as unsupported in Python Workers because `greenlet` is unavailable. In addition, the application starts a perpetual `asyncio` watchdog task at lifespan startup, uses native/compiled dependencies including NumPy and scikit-learn, and depends on persistent authenticated WebSocket room coordination. These components need individual Worker compatibility and lifecycle tests before a backend migration; do not point this application at a Worker backend based only on the FastAPI adapter example. See Cloudflare's [FastAPI Worker guide](https://developers.cloudflare.com/workers/languages/python/packages/fastapi/), [Python package compatibility](https://developers.cloudflare.com/workers/languages/python/packages/), and [Hyperdrive Python limitations](https://developers.cloudflare.com/hyperdrive/examples/python-workers/).

## Cloudflare Pages project settings

Use the existing Git-connected Pages project if one already exists. Its configured project name must match `name` in `frontend/wrangler.jsonc` and the CLI command below; if the dashboard project has another name, update the config's `name` and commands to match it.

Configure **Settings → Builds & deployments → Build configurations**:

| Setting | Value |
| --- | --- |
| Framework preset | React (Vite) |
| Production branch | `main` after the branch is reviewed and merged; do not change it as part of this preparation |
| Root directory (advanced) | `frontend` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Build system version | Current default |
| Build environment variable | `NODE_VERSION=22.16.0` (required by `frontend/package.json`) |

Vite's production build runs `tsc -b && vite build`. Pages serves the result as a static single-page app. Pages automatically falls back to `/` for client-side routes when the output has no top-level `404.html`, which matches this Vite app; no API or WebSocket route is implemented by Pages.

Under **Settings → Environment variables**, add these build-time variables for both **Production** and **Preview** (use the corresponding backend URL if a separate staging backend is available):

| Variable | Production value |
| --- | --- |
| `VITE_API_URL` | `https://cipher-vault-room.onrender.com/api` |
| `VITE_WS_URL` | `wss://cipher-vault-room.onrender.com` |

These URLs are public frontend configuration, not secrets. Do not add database credentials, JWT signing keys, user tokens, or encryption keys to Pages variables. The backend remains responsible for secrets and database access. The backend must accept the Pages production and selected preview origins for REST CORS; update its existing `CORS_ORIGINS` setting to the exact Pages origins when those hostnames are known. The WebSocket endpoint also must remain reachable over `wss://` at the same backend origin. Do not change the Render database or run schema initialization/migrations to host this frontend.

## Preview validation plan (not run)

No Cloudflare deployment has been created by this change. When ready to test, use a staging FastAPI service backed by a non-production PostgreSQL database, set the Preview environment variables to that staging API and WebSocket origin, and allow only the resulting Pages preview origin in that staging backend's CORS configuration. Then push `cloudflare-migration` only when you are ready for the connected Pages project to create a preview deployment. Test account creation/sign-in, room creation and membership, simultaneous edits in two separate rooms, refresh/reconnect, encrypted document persistence, and browser-to-Tauri collaboration if the staging service can be reached from a separate desktop device. Confirm that the production branch remains `main` and that no Render production deployment or database operation was triggered.

Do not run write-capable collaboration checks against production user data as part of a preview smoke test. Cloudflare Pages preview deploys frontend assets; they do not provide a backend or isolated database by themselves.

## Commands

Run from the repository root:

```powershell
cd frontend
npm ci
npm run build
```

To publish manually after choosing a project name and configuring its environment, run from `frontend`:

```powershell
npx wrangler pages deploy dist --project-name vaultroom
```

For Git-connected Pages, the dashboard build settings above perform the build and deployment automatically when an eligible branch is pushed. Do not run the manual deploy command until deployment is authorized. The GitHub branch is intentionally not pushed as part of this preparation, to avoid triggering an automatic preview deployment.

## Existing backend requirements

The current Render backend still needs its existing `DATABASE_URL` and `JWT_SECRET_KEY`; keep those only in Render's environment settings. Set `CORS_ORIGINS` there to the exact production Pages origin and the specific preview origin(s) being tested, while preserving any origins needed by the existing desktop/local clients. The current backend also has an unrestricted HTTP(S) `allow_origin_regex` in its CORS middleware, so that setting currently does not enforce an origin allowlist by itself; tighten that separately before treating origin restrictions as a security boundary.
