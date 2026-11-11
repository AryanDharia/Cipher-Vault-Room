import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyRemotePresenceToMap,
  getActiveTypingUsernames,
  hashClientId,
  isEditingKeydown,
  isLocalTipTapUpdate,
  pruneDisconnectedPresence,
} from '../src/lib/presenceTracker.ts';
import {
  dedupeSources,
  removeSourceById,
  upsertSource,
} from '../src/lib/sourceList.ts';
import {
  buildExportArtifact,
  extractDocumentContent,
  sanitizeFilenameSegment,
  tiptapJsonToMarkdown,
  triggerBlobDownload,
} from '../src/lib/documentExport.ts';

// ---------------------------------------------------------------------------
// BUG 1: "Who is Editing" / Awareness False Positives
// ---------------------------------------------------------------------------

test('presence: excludes current user by stable userId even when echoed remotely', () => {
  const states = new Map();
  const localClientId = 1001;
  states.set(localClientId, {
    user: { userId: 'u-alice', username: 'alice', isTyping: true, lastActive: 5000, docId: 'doc-1' },
  });

  // Self echo coming back over WS
  const echoRes = applyRemotePresenceToMap(
    states,
    localClientId,
    {
      room_code: 'VAULT1',
      user_id: 'u-alice',
      username: 'alice',
      cursor: { isTyping: true, docId: 'doc-1' },
    },
    { currentUserId: 'u-alice', currentUsername: 'alice', docId: 'doc-1', roomCode: 'VAULT1', now: 5000 }
  );
  assert.equal(echoRes.changed, false);

  const active = getActiveTypingUsernames(states, localClientId, {
    currentUserId: 'u-alice',
    currentUsername: 'alice',
    docId: 'doc-1',
    now: 5100,
  });
  assert.deepEqual(active, []);
});

test('presence: ignores remote Yjs sync updates & non-editing keys, only fires on genuine local edits', () => {
  const ySyncKey = { key: 'y-sync$' };

  // Remote Yjs sync transaction (isChangeOrigin: true) must NOT trigger typing indicator
  const remoteTr = {
    docChanged: true,
    getMeta: (k) => (k === ySyncKey ? { isChangeOrigin: true } : undefined),
  };
  assert.equal(isLocalTipTapUpdate(remoteTr, ySyncKey), false);

  // Selection-only transaction must NOT trigger typing
  const selectionTr = { docChanged: false, getMeta: () => undefined };
  assert.equal(isLocalTipTapUpdate(selectionTr, ySyncKey), false);

  // Local edit transaction DOES trigger typing
  const localTr = { docChanged: true, getMeta: () => undefined };
  assert.equal(isLocalTipTapUpdate(localTr, ySyncKey), true);

  // Modifier & navigation keys must NOT trigger typing
  assert.equal(isEditingKeydown({ key: 'Shift' }), false);
  assert.equal(isEditingKeydown({ key: 'ArrowDown' }), false);
  assert.equal(isEditingKeydown({ key: 'c', ctrlKey: true }), false);
  assert.equal(isEditingKeydown({ key: 'v', metaKey: true }), false);

  // Genuine character / edit keys DO trigger typing
  assert.equal(isEditingKeydown({ key: 'a' }), true);
  assert.equal(isEditingKeydown({ key: 'Backspace' }), true);
  assert.equal(isEditingKeydown({ key: 'Enter' }), true);
});

test('presence: clears on doc switch, inactivity timeout, room mismatch, and disconnect; handles multiple editors', () => {
  const states = new Map();
  const localClientId = 42;

  // Bob and Carol are typing in doc-1
  applyRemotePresenceToMap(
    states,
    localClientId,
    { room_code: 'VAULT1', user_id: 'u-bob', username: 'bob', cursor: { isTyping: true, docId: 'doc-1' } },
    { currentUserId: 'u-alice', docId: 'doc-1', roomCode: 'VAULT1', now: 10000 }
  );
  applyRemotePresenceToMap(
    states,
    localClientId,
    { room_code: 'VAULT1', user_id: 'u-carol', username: 'carol', cursor: { isTyping: true, docId: 'doc-1' } },
    { currentUserId: 'u-alice', docId: 'doc-1', roomCode: 'VAULT1', now: 10500 }
  );
  // Another room's broadcast must be ignored
  const otherRoom = applyRemotePresenceToMap(
    states,
    localClientId,
    { room_code: 'OTHER9', user_id: 'u-mallory', username: 'mallory', cursor: { isTyping: true, docId: 'doc-1' } },
    { currentUserId: 'u-alice', docId: 'doc-1', roomCode: 'VAULT1', now: 10500 }
  );
  assert.equal(otherRoom.changed, false);

  assert.deepEqual(
    getActiveTypingUsernames(states, localClientId, { currentUserId: 'u-alice', docId: 'doc-1', now: 11000 }),
    ['bob', 'carol']
  );

  // Carol switches to doc-2 -> cleared immediately from doc-1
  applyRemotePresenceToMap(
    states,
    localClientId,
    { room_code: 'VAULT1', user_id: 'u-carol', username: 'carol', cursor: { isTyping: true, docId: 'doc-2' } },
    { currentUserId: 'u-alice', docId: 'doc-1', roomCode: 'VAULT1', now: 11200 }
  );
  assert.deepEqual(
    getActiveTypingUsernames(states, localClientId, { currentUserId: 'u-alice', docId: 'doc-1', now: 11200 }),
    ['bob']
  );

  // Re-add Carol briefly then disconnect Bob via onlineUsers update
  applyRemotePresenceToMap(
    states,
    localClientId,
    { room_code: 'VAULT1', user_id: 'u-carol', username: 'carol', cursor: { isTyping: true, docId: 'doc-1' } },
    { currentUserId: 'u-alice', docId: 'doc-1', roomCode: 'VAULT1', now: 11300 }
  );
  const removed = pruneDisconnectedPresence(states, localClientId, [
    { user_id: 'u-alice', username: 'alice' },
    { user_id: 'u-carol', username: 'carol' },
  ]);
  assert.equal(removed.length, 1);
  assert.equal(removed[0], hashClientId('u-bob', localClientId));
  assert.deepEqual(
    getActiveTypingUsernames(states, localClientId, { currentUserId: 'u-alice', docId: 'doc-1', now: 11400 }),
    ['carol']
  );

  // After TTL expires (11300 + 3000 <= 14500), Carol also clears
  assert.deepEqual(
    getActiveTypingUsernames(states, localClientId, { currentUserId: 'u-alice', docId: 'doc-1', now: 14500 }),
    []
  );
});

// ---------------------------------------------------------------------------
// BUG 2: Source File Deduplication
// ---------------------------------------------------------------------------

test('sources: HTTP response + WebSocket SOURCE_ADDED race produces exactly one entry per server ID', () => {
  const uploaded = {
    id: 'src-server-101',
    title: 'spec.pdf',
    filename: 'spec.pdf',
    source_type: 'pdf',
    file_size: 2048,
  };

  // HTTP POST resolves first, then WS SOURCE_ADDED arrives
  let list = [];
  list = upsertSource(list, uploaded);
  list = upsertSource(list, uploaded);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'src-server-101');

  // Reverse race on peer or slow client: WS broadcast arrives multiple times + refreshSources
  let peerList = [];
  peerList = upsertSource(peerList, uploaded);
  peerList = upsertSource(peerList, { ...uploaded, title: 'spec.pdf (updated)' });
  peerList = dedupeSources([...peerList, uploaded]);
  assert.equal(peerList.length, 1);
  assert.equal(peerList[0].title, 'spec.pdf');

  // Two distinct uploads with identical filenames but distinct server IDs remain distinct entries
  const secondUploadSameFilename = {
    id: 'src-server-202',
    title: 'spec.pdf',
    filename: 'spec.pdf',
    source_type: 'pdf',
    file_size: 4096,
  };
  peerList = upsertSource(peerList, secondUploadSameFilename);
  assert.equal(peerList.length, 2);

  // Removing one removes only that ID
  peerList = removeSourceById(peerList, 'src-server-101');
  assert.deepEqual(peerList.map((s) => s.id), ['src-server-202']);
});

// ---------------------------------------------------------------------------
// BUG 3: Document Export Content Extraction, Filename Sanitization & Blob Download
// ---------------------------------------------------------------------------

test('export: serializes TipTap JSON to Markdown, sanitizes filenames, and revokes ObjectURL asynchronously', () => {
  const jsonDoc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Quarterly Audit' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Status: ' },
          { type: 'text', marks: [{ type: 'bold' }], text: 'Verified' },
        ],
      },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Key rotated' }] }] },
        ],
      },
    ],
  };

  const md = tiptapJsonToMarkdown(jsonDoc);
  assert.equal(md, '# Quarterly Audit\n\nStatus: **Verified**\n\n- Key rotated');

  const doc = { id: 'doc-1', title: 'Q4/Audit: "Secrets"?', doc_type: 'document' };
  const extracted = extractDocumentContent({
    doc,
    format: 'markdown',
    plaintext: '',
    editorJson: jsonDoc,
    editorText: 'fallback',
  });
  assert.equal(extracted, md);

  const exportMeta = {
    export_id: 'VR-EXP-ABCD1234',
    watermark: 'CONFIDENTIAL // VAULTROOM [ROOM1]',
  };
  const artifact = buildExportArtifact({ doc, content: extracted, exportMeta, format: 'markdown' });
  assert.equal(sanitizeFilenameSegment(doc.title), 'Q4_Audit_Secrets');
  assert.equal(artifact.filename, 'Q4_Audit_Secrets_VR-EXP-ABCD1234.md');
  assert.equal(artifact.mimeType, 'text/markdown;charset=utf-8');
  assert.ok(artifact.content.startsWith('<!-- CONFIDENTIAL // VAULTROOM [ROOM1] -->\n\n# Quarterly Audit'));

  // Verify triggerBlobDownload appends <a> to DOM, clicks it, removes it, and defers URL revocation
  let appended = null;
  let removed = null;
  let clicked = false;
  let revokedImmediately = false;
  let scheduledFn = null;
  const fakeAnchor = {
    href: '',
    download: '',
    style: {},
    parentNode: null,
    click() {
      clicked = true;
    },
  };
  const fakeDoc = {
    body: {
      appendChild(node) {
        appended = node;
        node.parentNode = fakeDoc.body;
      },
      removeChild(node) {
        removed = node;
        node.parentNode = null;
      },
    },
    createElement(tag) {
      assert.equal(tag, 'a');
      return fakeAnchor;
    },
  };
  const fakeURL = {
    createObjectURL() {
      return 'blob:vaultroom/export-1';
    },
    revokeObjectURL(url) {
      assert.equal(url, 'blob:vaultroom/export-1');
      revokedImmediately = true;
    },
  };

  triggerBlobDownload(artifact.content, artifact.filename, artifact.mimeType, {
    document: fakeDoc,
    URL: fakeURL,
    setTimeoutFn: (fn, delay) => {
      assert.ok(delay >= 1000);
      scheduledFn = fn;
    },
  });

  assert.equal(appended, fakeAnchor);
  assert.equal(removed, fakeAnchor);
  assert.equal(clicked, true);
  assert.equal(fakeAnchor.download, artifact.filename);
  assert.equal(revokedImmediately, false, 'revokeObjectURL must NOT run synchronously before download begins');
  assert.ok(scheduledFn);
  scheduledFn();
  assert.equal(revokedImmediately, true);
});
