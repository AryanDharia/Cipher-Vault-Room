# VaultRoom Architecture & Technical Specification

VaultRoom is a standalone, security-first collaborative document workspace, code editor, and real-time cybersecurity lab designed for confidential financial and technical operations.

---

## 1. System Topology

```
+-------------------------------------------------------------------------+
|                           CLIENT BROWSER                                |
|  - TipTap Collaborative Editor (ProseMirror CRDT integration)           |
|  - Client-Side Zero-Knowledge Encryption Engine (Web Crypto API)        |
|  - AES-256-GCM authenticated envelopes + PBKDF2 key derivation         |
|  - Forensic document watermarking with cryptographic tracking tokens   |
|  - Sensitive data auto-masking (PAN/Bank credentials UI masking)        |
+-------------------------------------------------------------------------+
                     │                                   ▲
  REST / JSON (HTTPS)│                                   │ WebSockets (WSS)
  (Auth, Metadata)   ▼                                   │ (Encrypted Updates)
+─────────────────────────────────────────────────────────────────────────+
|                        PYTHON FASTAPI BACKEND                           |
|  - Scoped JWT authentication & Argon2id password hashing                |
|  - Room lifecycle & 6-character unambiguous code allocator              |
|  - Blind relay WebSocket synchronization manager                       |
|  - Role-based authorization: Owner, Key Holder, Editor, Viewer          |
|  - Configurable 2-of-3 Threshold Key approval consensus engine          |
|  - Scikit-learn Isolation Forest anomaly detector (metadata-only)       |
|  - 30-Second Scripted Heist Mode simulation engine                     |
+─────────────────────────────────────────────────────────────────────────+
                     │
                     ▼
+─────────────────────────────────────────────────────────────────────────+
|                          DATABASE STORAGE                               |
|  - SQLite (Local Dev) / PostgreSQL (Production)                         |
|  - Encrypted ciphertext envelopes only (ZERO plaintext storage)        |
|  - Masked Key Locker credentials                                        |
|  - Tamper-evident security audit log & tracking records                 |
+─────────────────────────────────────────────────────────────────────────+
```

---

## 2. Zero-Knowledge Cryptographic Specification

### Threat Model & Boundaries
- **Adversary Model**: The server host, database administrator, network eavesdropper, or compromised backend process is considered an untrusted third party regarding confidential documents and secrets.
- **Client Encryption**: Before any document revision or secret is transmitted to the backend, it is encrypted in the user's browser using AES-GCM 256-bit with an independently generated 12-byte initialization vector (`iv`).
- **Zero Plaintext Leakage**:
  - The server stores only `{ v: 1, iv: "...", ciphertext: "...", auth_tag: "..." }`.
  - Passphrases and raw `CryptoKey` handles NEVER leave the browser memory.
  - Server logs, debug traces, and database tables never record plaintext.
- **Envelope Authenticity**: AES-GCM guarantees both confidentiality and ciphertext integrity. Any tampering or bit-flipping during transit causes the Web Crypto API to fail with a verification error.

---

## 3. Quorum & Threshold Key Approvals (2-of-3 Model)

VaultRoom enforces multi-party consensus for sensitive documents and vault secrets:
1. **Configurable Policy**: Default is set to **2-of-3 key-holder approvals**.
2. **Distinct Key Holders**: Room members with the role `key_holder` or `owner` can cast votes.
3. **Double-Voting Prevention**: The backend verifies that no single key holder can approve a request twice.
4. **Binding**: Each approval request is bound to a specific resource identifier (e.g., `doc:{id}` or `secret:{id}`) and expires after 2 hours.
5. **State Transitions**: The request atomically shifts from `pending` -> `approved` when the threshold is satisfied, or `rejected` when mathematically unobtainable.

---

## 4. Metadata-Only Anomaly Guard (Isolation Forest)

To detect automated intrusion without violating zero-knowledge guarantees:
- **Zero Content Inspection**: The scikit-learn anomaly detector operates strictly on non-content numerical metadata features:
  1. `export_rate` (exports per minute)
  2. `auth_failures` (authentication and authorization rejections)
  3. `request_rate` (request frequency per second)
  4. `perm_changes` (privilege escalation attempts)
  5. `sensitive_access` (unlock / threshold query spikes)
- **Model**: An unsupervised `IsolationForest` fits a baseline profile of expected collaboration metrics and flags out-of-distribution bursts.
- **Simulated vs. Real**: All simulation runs are tagged with `is_simulated: true` in the audit stream, clearly delineating educational simulations from real detections.
