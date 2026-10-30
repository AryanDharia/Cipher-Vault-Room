# VaultRoom Windows Desktop (Tauri)

The desktop application packages the existing React frontend in Tauri/WebView2. It uses the same FastAPI service, PostgreSQL database, account system, room permissions, REST API, and WebSocket endpoint as the browser application. It does not include a backend or local database; the service must be online for authentication, rooms, saved documents, and collaboration.

The current Render blueprint service is named `cipher-vault-room`, and the desktop default backend URL is `https://cipher-vault-room.onrender.com`. If Render assigns a different hostname, update the desktop endpoint in `frontend/src-tauri/src/lib.rs`, the WebSocket URL in `frontend/src/lib/websocket.ts`, and the CSP in `frontend/src-tauri/tauri.conf.json` before building.

## Windows build prerequisites

- Windows 10 or newer with WebView2 Runtime.
- Rust stable with the MSVC target and Cargo (`rustup` installer).
- Visual Studio 2022 Build Tools with **Desktop development with C++** and a Windows SDK.
- Node.js 22 or newer and npm.
- VBSCRIPT optional Windows feature enabled for MSI packaging.

From `frontend/` run:

```powershell
npm ci
npm run desktop:dev
npm run desktop:build
```

The installer target is MSI. The expected output is under `frontend/src-tauri/target/release/bundle/msi/`. The installer uses the WebView2 bootstrapper download mode, so first installation needs internet if WebView2 is not present. A production release should be code-signed before distribution.

## Credential handling

The desktop client stores the JWT session token and room passphrases in Windows Credential Manager through native Tauri commands. They are not written to WebView localStorage. Credentials are loaded into memory when the app starts and removed on logout, account removal, or when the user is removed from a room. The browser client keeps its existing browser storage behavior and remains independent.

The React app performs client-side encryption and UI rendering inside WebView2. PDF previews render locally from an authenticated file blob. DOCX preview currently uses extracted text supplied with the room source; it does not add an offline DOCX parser. No persistent plaintext document cache is created by the desktop shell.

## Collaboration and manual sync

The editor uses a separate Yjs document per room document. WebSocket updates remain client-encrypted, and the server acknowledges an update only after its database transaction commits. **Sync Now** sends any pending Yjs changes, waits for that acknowledgement, fetches the latest encrypted update history, and merges missing Yjs structs into the open editor using a state-vector diff. It does not replace the editor contents with a snapshot.

When the network is unavailable, encrypted Yjs updates and an encrypted local Yjs state cache are stored in the browser/WebView IndexedDB for that room and document. They are retried when the WebSocket reconnects or when **Sync Now** is pressed. The status stays at **Unsaved changes**, **Offline**, **Reconnecting…**, or **Sync failed — Retry** until server persistence is confirmed. Plaintext and room keys are not written to this cache.

## Release validation checklist

Do not release until all of these pass against the deployed backend without changing the Render service or database:

1. Install the MSI on a Windows device and sign in with an existing browser account.
2. Join a room already used by a browser client; verify role and permissions match.
3. Edit the same document from desktop and browser and verify updates in both directions.
4. Disconnect and reconnect the desktop network; verify the socket reconnects and the latest saved document is restored after reconnect/relaunch.
5. Verify a second room does not receive the first room's updates.
6. Open a PDF source and a DOCX source from the desktop UI.
7. Sign out and verify the saved desktop session token is removed from Credential Manager.
8. Install on a separate device and repeat the desktop-to-web and web-to-desktop edit checks with two authenticated users.

These cross-device checks require a running production/staging backend and separate devices. They were not executed as part of preparing the Tauri shell.
