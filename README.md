# VaultRoom
### Secure Collaborative Code Editor, Document Workspace & Real-Time Security Lab

VaultRoom is an enterprise-grade, privacy-first workspace engineered for confidential documents, sensitive codebases, and financial agreements. It combines real-time collaborative text editing with client-side Zero-Knowledge encryption, NotebookLM-inspired reference source curation, multi-person threshold quorum approvals (2-of-3), and an interactive cybersecurity demonstration lab.

---

## Key Capabilities

- **Zero-Knowledge by Design**: Documents and vault secrets are encrypted in the browser using the **Web Crypto API (AES-GCM 256-bit with PBKDF2)** before transmission. The server never observes plaintext or document encryption keys.
- **Collaborative Editor**: Multi-user rich-text document editing powered by **TipTap**, paired with syntax-highlighted code editing, collaborator presence, and autosave state tracking.
- **Six-Character Room System**: Reimplemented room server inspired by PlayBreak's architecture in **Python FastAPI & WebSockets**, utilizing unambiguous 6-character room codes (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`) with cryptographic randomness and room lifecycle expiration.
- **Configurable 2-of-3 Threshold Approvals**: Unlocking protected documents or sensitive credentials requires consensus from designated key holders, preventing single-point compromise and enforcing double-voting prevention.
- **Key Locker**: Secure in-room credentials vault for API keys, tokens, and database passwords, masked in the UI and decrypted client-side only upon authorized reveal.
- **Source Library (NotebookLM-Inspired)**: Organize research and reference material with PDF uploads, web URLs, markdown notes, and source previews.
- **Forensic Watermarking & Leak Tracing**: Generates unique cryptographic export tracking IDs and personalized visible watermarks with user metadata on exported documents.
- **AI Security Guard (Isolation Forest)**: Metadata-only anomaly detection powered by **scikit-learn Isolation Forest**, flagging burst exports, credential stuffing, and unauthorized resource access without inspecting plaintext contents.
- **Heist Mode Simulation**: An interactive 30-second scripted cybersecurity demonstration illustrating automated threat detection, room lockdown containment, and incident response reporting.

---

## Architecture

```
VaultRoom/
├── frontend/                     # React + TypeScript + Vite + Tailwind + TipTap
│   ├── src/
│   │   ├── components/           # Navbar, Sidebar, RightSidebar, EditorView, ActivityFeed, HeistModal
│   │   ├── lib/                  # Web Crypto API engine, WebSocket client, API client
│   │   └── App.tsx               # Main application container
│   ├── package.json
│   └── vite.config.ts
├── backend/                      # Python FastAPI + SQLAlchemy + WebSockets
│   ├── app/
│   │   ├── api/                  # REST endpoints: auth, rooms, docs, vault, approvals, sources, security
│   │   ├── auth/                 # Argon2id hashing, JWT access tokens, role dependencies
│   │   ├── rooms/                # 6-character room allocator, membership lifecycle
│   │   ├── collaboration/        # Blind WebSocket relay manager, cursor presence, rate limiting
│   │   ├── ai/                   # Scikit-learn Isolation Forest metadata anomaly pipeline
│   │   ├── heist/                # Controlled 30-second defensive simulation engine
│   │   ├── database/             # SQLAlchemy async models & session factory
│   │   └── config.py             # Pydantic environment settings
│   ├── tests/                    # Pytest suite covering auth, rooms, encryption, and sync
│   └── requirements.txt
├── docs/                         # Architecture, Deployment, and Test execution reports
├── .env.example
├── .gitignore
└── README.md
```

---

## Quickstart & Local Setup

### 1. Prerequisites
- **Python 3.11+**
- **Node.js 18+** and **npm**

### 2. Backend Setup
```bash
# 1. Navigate to backend
cd backend

# 2. Create and activate virtual environment
python -m venv .venv
# On Windows:
.venv\Scripts\activate
# On Linux/macOS:
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Copy environment configuration
cp ../.env.example .env

# 5. Start the backend server
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
The backend API and interactive docs will be live at:
- API: `http://127.0.0.1:8000`
- Swagger Docs: `http://127.0.0.1:8000/docs`
- Health check: `http://127.0.0.1:8000/health`

### 3. Frontend Setup
```bash
# 1. Navigate to frontend in a new terminal
cd frontend

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev
```
The developer console will be accessible at:
- `http://localhost:5173`

---

## Running the Automated Test Suite

```bash
cd backend
.venv\Scripts\python -m pytest tests -v
```
All tests verify room creation, 6-character codes, Argon2id hashing, JWT authentication, end-to-end zero-knowledge envelope storage, 2-of-3 threshold voting, scikit-learn anomaly detection, and two-client WebSocket collaboration.

---

## Threat Model & Security Properties

For full architectural diagrams, threat model boundaries, and production deployment checklists, refer to the [docs/](docs/) directory:
- [Architecture & Cryptographic Specification](docs/ARCHITECTURE.md)
- [Deployment & Operations Guide](docs/DEPLOYMENT.md)
- [Verification & Test Execution Report](docs/TEST_REPORT.md)
