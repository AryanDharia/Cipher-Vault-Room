import * as Y from 'yjs';
import type { CollaborationOutbox, PendingCollaborationUpdate } from './collaborationOutbox';

export interface StoredCollaborationUpdate {
  update_id: string;
  encrypted_payload: string;
}

export interface CollaborationHistory {
  initialized: boolean;
  updated_at?: string | null;
  updates: StoredCollaborationUpdate[];
}

interface SyncDocumentOptions {
  roomCode: string;
  documentId: string;
  localDoc: Y.Doc;
  outbox: CollaborationOutbox;
  listServerHistory: () => Promise<CollaborationHistory>;
  publishPersisted: (updateId: string, encryptedPayload: string) => Promise<string | null>;
  encryptUpdate: (update: Uint8Array) => Promise<string>;
  decryptUpdate: (payload: string) => Promise<Uint8Array>;
  applyServerUpdate: (updateId: string, update: Uint8Array) => void;
  hasAppliedUpdate: (updateId: string) => boolean;
}

export interface SyncDocumentResult {
  lastSyncedAt: string | null;
  appliedRemoteUpdates: number;
  pushedLocalUpdates: number;
}

export async function synchronizeYDoc(options: SyncDocumentOptions): Promise<SyncDocumentResult> {
  const {
    roomCode, documentId, localDoc, outbox, listServerHistory, publishPersisted,
    encryptUpdate, decryptUpdate, applyServerUpdate, hasAppliedUpdate,
  } = options;
  let pushedLocalUpdates = 0;
  let appliedRemoteUpdates = 0;
  let lastSyncedAt: string | null = null;

  const sendPending = async (item: PendingCollaborationUpdate) => {
    lastSyncedAt = await publishPersisted(item.updateId, item.encryptedPayload);
    await outbox.remove(roomCode, documentId, item.updateId);
    pushedLocalUpdates += 1;
  };

  // The cached Yjs deltas are already applied to localDoc. The state-vector
  // reconciliation below either proves they reached the server or resends their
  // missing CRDT structs in one idempotent update.
  const cached = await outbox.list(roomCode, documentId);

  let history = await listServerHistory();
  if (history.initialized && !history.updates.length) {
    throw new Error('The server reported an initialized document without its saved Yjs state. Local changes were retained.');
  }
  const serverDoc = new Y.Doc();
  try {
    for (const item of history.updates) {
      const update = await decryptUpdate(item.encrypted_payload);
      Y.applyUpdate(serverDoc, update);
    }

    // State-vector diff sends only CRDT structs missing from the server. No
    // plaintext snapshot is uploaded and existing server structs are retained.
    const serverVector = Y.encodeStateVector(serverDoc);
    const missingLocalState = Y.encodeStateAsUpdate(localDoc, serverVector);
    if (missingLocalState.byteLength > 2) {
      const updateId = crypto.randomUUID();
      const encryptedPayload = await encryptUpdate(missingLocalState);
      await outbox.put({
        roomCode: roomCode.toUpperCase(), documentId, updateId, encryptedPayload, createdAt: Date.now(),
      });
      await sendPending({
        roomCode: roomCode.toUpperCase(), documentId, updateId, encryptedPayload, createdAt: Date.now(),
      });
    }
    // Every cached delta was included in localDoc before this sync. Once the
    // server vector acknowledged those structs (or already contained them),
    // stale outbox ciphertext can be retired without discarding local edits.
    for (const item of cached) {
      await outbox.remove(roomCode, documentId, item.updateId);
      pushedLocalUpdates += 1;
    }
  } finally {
    serverDoc.destroy();
  }

  // Re-read after the push. Applying updates into the existing Y.Doc preserves
  // Tiptap's selection and lets Yjs resolve concurrent edits without a reset.
  history = await listServerHistory();
  if (history.initialized && !history.updates.length) {
    throw new Error('The server reported an initialized document without its saved Yjs state. Local changes were retained.');
  }
  for (const item of history.updates) {
    if (hasAppliedUpdate(item.update_id)) continue;
    const update = await decryptUpdate(item.encrypted_payload);
    applyServerUpdate(item.update_id, update);
    appliedRemoteUpdates += 1;
  }
  lastSyncedAt = history.updated_at ?? lastSyncedAt;

  return { lastSyncedAt, appliedRemoteUpdates, pushedLocalUpdates };
}
