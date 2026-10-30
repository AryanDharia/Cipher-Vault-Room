export interface PendingCollaborationUpdate {
  roomCode: string;
  documentId: string;
  updateId: string;
  encryptedPayload: string;
  createdAt: number;
}

export interface CollaborationOutbox {
  put(update: PendingCollaborationUpdate): Promise<void>;
  list(roomCode: string, documentId: string): Promise<PendingCollaborationUpdate[]>;
  remove(roomCode: string, documentId: string, updateId: string): Promise<void>;
  putSnapshot(roomCode: string, documentId: string, encryptedPayload: string): Promise<void>;
  getSnapshot(roomCode: string, documentId: string): Promise<string | null>;
  removeSnapshot(roomCode: string, documentId: string): Promise<void>;
}

const DATABASE_NAME = 'vaultroom-collaboration-outbox';
const STORE_NAME = 'updates';
const STORE_VERSION = 1;

class IndexedDbCollaborationOutbox implements CollaborationOutbox {
  private database: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('Encrypted offline sync storage is unavailable in this browser'));
        return;
      }
      const request = indexedDB.open(DATABASE_NAME, STORE_VERSION);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('room_document', ['roomCode', 'documentId'], { unique: false });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not open encrypted offline sync storage'));
      request.onblocked = () => reject(new Error('Encrypted offline sync storage is blocked by another app tab'));
    }).catch((error) => {
      this.database = null;
      throw error;
    });
    return this.database!;
  }

  async put(update: PendingCollaborationUpdate): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({
        ...update,
        kind: 'update',
        key: `${update.roomCode}:${update.documentId}:${update.updateId}`,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not preserve offline document changes'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not preserve offline document changes'));
    });
  }

  async list(roomCode: string, documentId: string): Promise<PendingCollaborationUpdate[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).index('room_document')
        .getAll(IDBKeyRange.only([roomCode.toUpperCase(), documentId]));
      request.onsuccess = () => resolve((request.result as Array<PendingCollaborationUpdate & { key: string }>)
        .filter((item) => (item as any).kind === 'update')
        .map(({ roomCode: storedRoom, documentId: storedDoc, updateId, encryptedPayload, createdAt }) => ({
          roomCode: storedRoom,
          documentId: storedDoc,
          updateId,
          encryptedPayload,
          createdAt,
        }))
        .sort((a, b) => a.createdAt - b.createdAt));
      request.onerror = () => reject(request.error ?? new Error('Could not read pending offline changes'));
    });
  }

  async remove(roomCode: string, documentId: string, updateId: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(`${roomCode.toUpperCase()}:${documentId}:${updateId}`);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not clear persisted offline change'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not clear persisted offline change'));
    });
  }

  async putSnapshot(roomCode: string, documentId: string, encryptedPayload: string): Promise<void> {
    const db = await this.open();
    const normalizedRoom = roomCode.toUpperCase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({
        key: `${normalizedRoom}:${documentId}:__snapshot__`,
        kind: 'snapshot',
        roomCode: normalizedRoom,
        documentId,
        encryptedPayload,
        createdAt: Date.now(),
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not preserve encrypted offline document state'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not preserve encrypted offline document state'));
    });
  }

  async getSnapshot(roomCode: string, documentId: string): Promise<string | null> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME)
        .get(`${roomCode.toUpperCase()}:${documentId}:__snapshot__`);
      request.onsuccess = () => resolve(request.result?.encryptedPayload ?? null);
      request.onerror = () => reject(request.error ?? new Error('Could not restore encrypted offline document state'));
    });
  }

  async removeSnapshot(roomCode: string, documentId: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(`${roomCode.toUpperCase()}:${documentId}:__snapshot__`);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not clear the encrypted local document copy'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Could not clear the encrypted local document copy'));
    });
  }
}

export const collaborationOutbox: CollaborationOutbox = new IndexedDbCollaborationOutbox();
