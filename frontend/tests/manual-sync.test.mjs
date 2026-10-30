import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';
import StarterKit from '@tiptap/starter-kit';
import { getSchema } from '@tiptap/core';
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from 'y-prosemirror';
import { synchronizeYDoc } from '../src/lib/collaborationSync.ts';
import { VaultWebSocket } from '../src/lib/websocket.ts';

class MemoryOutbox {
  entries = new Map();
  snapshots = new Map();
  key(room, doc, id) { return `${room}:${doc}:${id}`; }
  async put(update) { this.entries.set(this.key(update.roomCode, update.documentId, update.updateId), update); }
  async list(roomCode, documentId) {
    return [...this.entries.values()]
      .filter((item) => item.roomCode === roomCode.toUpperCase() && item.documentId === documentId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  async remove(roomCode, documentId, updateId) { this.entries.delete(this.key(roomCode.toUpperCase(), documentId, updateId)); }
  async putSnapshot(roomCode, documentId, encryptedPayload) { this.snapshots.set(`${roomCode.toUpperCase()}:${documentId}`, encryptedPayload); }
  async getSnapshot(roomCode, documentId) { return this.snapshots.get(`${roomCode.toUpperCase()}:${documentId}`) ?? null; }
  async removeSnapshot(roomCode, documentId) { this.snapshots.delete(`${roomCode.toUpperCase()}:${documentId}`); }
}

const encode = (bytes) => Buffer.from(bytes).toString('base64');
const decode = (value) => new Uint8Array(Buffer.from(value, 'base64'));

function makeServer(seed = '') {
  const doc = new Y.Doc();
  if (seed) doc.getText('code').insert(0, seed);
  const updates = new Map();
  if (seed) updates.set('server-seed', encode(Y.encodeStateAsUpdate(doc)));
  return {
    doc,
    updates,
    failNext: false,
    async publish(updateId, payload) {
      if (this.failNext) {
        this.failNext = false;
        throw new Error('persistence unavailable');
      }
      const previous = updates.get(updateId);
      if (previous && previous !== payload) throw new Error('idempotency key payload mismatch');
      if (!previous) {
        updates.set(updateId, payload);
        Y.applyUpdate(doc, decode(payload));
      }
      return '2026-10-30T12:00:00.000Z';
    },
    async list() {
      return {
        initialized: true,
        updated_at: '2026-10-30T12:00:00.000Z',
        updates: [...updates.entries()].map(([update_id, encrypted_payload]) => ({ update_id, encrypted_payload })),
      };
    },
    async applyRemoteEdit(index, value) {
      const remote = new Y.Doc();
      Y.applyUpdate(remote, Y.encodeStateAsUpdate(doc));
      const vector = Y.encodeStateVector(doc);
      remote.getText('code').insert(index, value);
      const update = Y.encodeStateAsUpdate(remote, vector);
      updates.set(`remote-${crypto.randomUUID()}`, encode(update));
      Y.applyUpdate(doc, update);
      remote.destroy();
    },
  };
}

function syncOptions({ roomCode = 'ROOM01', documentId = 'doc-1', localDoc, server, outbox = new MemoryOutbox(), applied = new Set() }) {
  return {
    roomCode, documentId, localDoc, outbox,
    listServerHistory: () => server.list(),
    publishPersisted: (id, payload) => server.publish(id, payload),
    encryptUpdate: async (update) => encode(update),
    decryptUpdate: async (payload) => decode(payload),
    applyServerUpdate: (id, update) => { Y.applyUpdate(localDoc, update); applied.add(id); },
    hasAppliedUpdate: (id) => applied.has(id),
    applied,
  };
}

test('manual sync persists local Yjs edits and clears outbox only after acknowledgement', async () => {
  const server = makeServer('seed');
  const local = new Y.Doc();
  Y.applyUpdate(local, Y.encodeStateAsUpdate(server.doc));
  local.getText('code').insert(4, '-local');
  const options = syncOptions({ localDoc: local, server });
  const result = await synchronizeYDoc(options);
  assert.equal(server.doc.getText('code').toString(), 'seed-local');
  assert.equal((await options.outbox.list('ROOM01', 'doc-1')).length, 0);
  assert.ok(result.pushedLocalUpdates > 0);
  assert.equal(result.lastSyncedAt, '2026-10-30T12:00:00.000Z');
  local.destroy(); server.doc.destroy();
});

test('manual sync fetches and CRDT-merges remote edits into the existing local Y.Doc', async () => {
  const server = makeServer('base');
  const local = new Y.Doc();
  Y.applyUpdate(local, Y.encodeStateAsUpdate(server.doc));
  await server.applyRemoteEdit(4, '-remote');
  const originalClientId = local.clientID;
  const result = await synchronizeYDoc(syncOptions({ localDoc: local, server }));
  assert.equal(local.clientID, originalClientId);
  assert.equal(local.getText('code').toString(), 'base-remote');
  assert.ok(result.appliedRemoteUpdates > 0);
  local.destroy(); server.doc.destroy();
});

test('two concurrent users converge without replacing concurrent Yjs structures', async () => {
  const server = makeServer('base');
  const alice = new Y.Doc();
  const bob = new Y.Doc();
  const seed = Y.encodeStateAsUpdate(server.doc);
  Y.applyUpdate(alice, seed);
  Y.applyUpdate(bob, seed);
  alice.getText('code').insert(4, '-alice');
  bob.getText('code').insert(4, '-bob');
  await Promise.all([
    synchronizeYDoc(syncOptions({ localDoc: alice, server })),
    synchronizeYDoc(syncOptions({ localDoc: bob, server })),
  ]);
  await Promise.all([
    synchronizeYDoc(syncOptions({ localDoc: alice, server })),
    synchronizeYDoc(syncOptions({ localDoc: bob, server })),
  ]);
  assert.equal(alice.getText('code').toString(), bob.getText('code').toString());
  assert.match(alice.getText('code').toString(), /alice/);
  assert.match(alice.getText('code').toString(), /bob/);
  alice.destroy(); bob.destroy(); server.doc.destroy();
});

test('separate rooms retain independent server state', async () => {
  const servers = new Map([['ROOM-A', makeServer('A')], ['ROOM-B', makeServer('B')]]);
  const a = new Y.Doc();
  const b = new Y.Doc();
  Y.applyUpdate(a, Y.encodeStateAsUpdate(servers.get('ROOM-A').doc));
  Y.applyUpdate(b, Y.encodeStateAsUpdate(servers.get('ROOM-B').doc));
  a.getText('code').insert(1, '-only-a');
  b.getText('code').insert(1, '-only-b');
  await synchronizeYDoc(syncOptions({ roomCode: 'ROOM-A', localDoc: a, server: servers.get('ROOM-A') }));
  await synchronizeYDoc(syncOptions({ roomCode: 'ROOM-B', localDoc: b, server: servers.get('ROOM-B') }));
  assert.equal(servers.get('ROOM-A').doc.getText('code').toString(), 'A-only-a');
  assert.equal(servers.get('ROOM-B').doc.getText('code').toString(), 'B-only-b');
  a.destroy(); b.destroy();
  for (const server of servers.values()) server.doc.destroy();
});

test('offline edits remain encrypted in the outbox after persistence fails and retry idempotently', async () => {
  const server = makeServer('offline');
  const local = new Y.Doc();
  Y.applyUpdate(local, Y.encodeStateAsUpdate(server.doc));
  local.getText('code').insert(7, '-edit');
  const options = syncOptions({ localDoc: local, server });
  server.failNext = true;
  await assert.rejects(synchronizeYDoc(options), /persistence unavailable/);
  assert.equal((await options.outbox.list('ROOM01', 'doc-1')).length, 1);
  const result = await synchronizeYDoc(options);
  assert.equal(server.doc.getText('code').toString(), 'offline-edit');
  assert.equal((await options.outbox.list('ROOM01', 'doc-1')).length, 0);
  assert.ok(result.pushedLocalUpdates >= 1);
  local.destroy(); server.doc.destroy();
});

test('the encrypted local Yjs snapshot restores offline edits into a fresh client document', async () => {
  const original = new Y.Doc();
  original.getText('code').insert(0, 'offline-restored');
  const outbox = new MemoryOutbox();
  await outbox.putSnapshot('ROOM01', 'doc-1', encode(Y.encodeStateAsUpdate(original)));
  const restored = new Y.Doc();
  const cachedSnapshot = await outbox.getSnapshot('ROOM01', 'doc-1');
  Y.applyUpdate(restored, decode(cachedSnapshot));
  assert.equal(restored.getText('code').toString(), 'offline-restored');
  original.destroy(); restored.destroy();
});

test('repeated sync does not append duplicate empty updates', async () => {
  const server = makeServer('same');
  const local = new Y.Doc();
  Y.applyUpdate(local, Y.encodeStateAsUpdate(server.doc));
  const options = syncOptions({ localDoc: local, server });
  await synchronizeYDoc(options);
  const committedCount = server.updates.size;
  await synchronizeYDoc(options);
  assert.equal(server.updates.size, committedCount);
  local.destroy(); server.doc.destroy();
});

test('manual sync reconciles rich-text Y.XmlFragment edits without replacing the Tiptap document', async () => {
  const schema = getSchema([StarterKit.configure({ history: false })]);
  const seed = prosemirrorJSONToYDoc(schema, {
    type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'base' }] }],
  }, 'default');
  const server = makeServer();
  const seedUpdate = Y.encodeStateAsUpdate(seed);
  Y.applyUpdate(server.doc, seedUpdate);
  server.updates.set('rich-seed', encode(seedUpdate));
  const local = new Y.Doc();
  Y.applyUpdate(local, seedUpdate);
  local.getXmlFragment('default').get(0).get(0).insert(4, ' local');
  const originalClientId = local.clientID;
  const result = await synchronizeYDoc(syncOptions({ localDoc: local, server, documentId: 'rich-doc' }));
  assert.equal(local.clientID, originalClientId);
  const json = JSON.stringify(yDocToProsemirrorJSON(local, 'default'));
  assert.match(json, /base local/);
  assert.ok(result.pushedLocalUpdates > 0);
  local.destroy(); seed.destroy(); server.doc.destroy();
});

test('unauthorized history fetch and failed persistence reject instead of reporting sync success', async () => {
  const server = makeServer('private');
  const local = new Y.Doc();
  const options = syncOptions({ localDoc: local, server });
  options.listServerHistory = async () => { throw new Error('403 forbidden'); };
  await assert.rejects(synchronizeYDoc(options), /403 forbidden/);
  assert.equal((await options.outbox.list('ROOM01', 'doc-1')).length, 0);
  local.getText('code').insert(0, 'change');
  options.listServerHistory = () => server.list();
  server.failNext = true;
  await assert.rejects(synchronizeYDoc(options), /persistence unavailable/);
  assert.equal((await options.outbox.list('ROOM01', 'doc-1')).length, 1);
  local.destroy(); server.doc.destroy();
});

test('offline WebSocket buffers preserve updates for two users in each of two rooms', () => {
  const clients = [
    ['ROOM-A', 'alice'], ['ROOM-A', 'bob'], ['ROOM-B', 'carol'], ['ROOM-B', 'dave'],
  ].map(([roomCode, user]) => ({ roomCode, user, socket: new VaultWebSocket(roomCode, user) }));
  const originalLog = console.log;
  console.log = () => undefined;
  try {
    for (const client of clients) {
      for (let index = 0; index < 55; index += 1) {
        client.socket.send({
          type: 'YJS_UPDATE', update_id: `${client.user}-${index}`, document_id: `${client.roomCode}-doc`,
        });
      }
    }
  } finally {
    console.log = originalLog;
  }
  for (const client of clients) {
    const queued = client.socket.messageQueue.map((message) => message.update_id);
    assert.equal(queued.length, 55);
    assert.equal(queued[0], `${client.user}-0`);
    assert.equal(queued.at(-1), `${client.user}-54`);
  }
});

test('WebSocket send resolves only after the server persistence acknowledgement', async () => {
  const previousWebSocket = globalThis.WebSocket;
  const previousWindow = globalThis.window;
  class FakeWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSED = 3;
    static instances = [];
    readyState = FakeWebSocket.CONNECTING;
    sent = [];
    onopen = null;
    onmessage = null;
    onclose = null;
    onerror = null;
    constructor() { FakeWebSocket.instances.push(this); }
    send(message) { this.sent.push(message); }
    close() { this.readyState = FakeWebSocket.CLOSED; }
  }
  globalThis.WebSocket = FakeWebSocket;
  globalThis.window = {
    location: { protocol: 'https:', hostname: 'localhost', port: '5173', host: 'localhost:5173' },
    setTimeout,
    setInterval: () => 1,
    clearInterval: () => undefined,
  };
  const client = new VaultWebSocket('room01', 'token');
  try {
    client.connect();
    const socket = FakeWebSocket.instances.at(-1);
    socket.readyState = FakeWebSocket.OPEN;
    socket.onopen();
    const sent = client.sendAndWaitForPersistence({
      type: 'YJS_UPDATE', document_id: 'doc-1', update_id: 'update-1', encrypted_payload: 'opaque-ciphertext',
    }, 1000);
    let settled = false;
    void sent.then(() => { settled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    socket.onmessage({ data: JSON.stringify({
      type: 'YJS_UPDATE_ACK', document_id: 'doc-1', update_id: 'update-1', persisted_at: '2026-10-30T12:00:00Z',
    }) });
    assert.equal(await sent, '2026-10-30T12:00:00Z');
    client.disconnect();
  } finally {
    globalThis.WebSocket = previousWebSocket;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
