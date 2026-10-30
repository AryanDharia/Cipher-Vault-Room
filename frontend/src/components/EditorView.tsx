import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import * as Y from 'yjs';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';
import {
  Bold,
  Italic,
  Code,
  Heading1,
  Heading2,
  List,
  ListOrdered,
  Lock,
  Unlock,
  Download,
  Save,
  RefreshCw,
  CheckCircle,
  Eye,
  EyeOff,
  FileCode,
  Sparkles
} from 'lucide-react';
import { encryptEnvelope, decryptEnvelope } from '../lib/crypto';
import { api } from '../lib/api';
import { collaborationOutbox } from '../lib/collaborationOutbox';
import { synchronizeYDoc } from '../lib/collaborationSync';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

interface EditorViewProps {
  document: any;
  roomCode: string;
  roomKey: CryptoKey | null;
  isLocked: boolean;
  currentUserRole: string;
  onBroadcastDelta: (docId: string, updateId: string, encryptedPayload: string) => Promise<string | null>;
  onSaveStatusChange?: (status: 'saved' | 'saving' | 'unsaved') => void;
  latestDelta?: any;
  remoteDeltas?: any[];
  connectionState?: string;
}

export const EditorView: React.FC<EditorViewProps> = ({
  document: doc,
  roomCode,
  roomKey,
  isLocked,
  currentUserRole,
  onBroadcastDelta,
  onSaveStatusChange,
  remoteDeltas,
  connectionState,
}) => {
  const [plaintext, setPlaintext] = useState<string>('');
  const plaintextRef = useRef('');
  const codeTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [isDecrypting, setIsDecrypting] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'offline' | 'reconnecting' | 'unsaved' | 'failed'>('syncing');
  const [syncError, setSyncErrorState] = useState<string | null>(null);
  const syncErrorRef = useRef<string | null>(null);
  const setSyncError = (message: string | null) => {
    syncErrorRef.current = message;
    setSyncErrorState(message);
  };
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const syncPromiseRef = useRef<Promise<void> | null>(null);
  const syncNowRef = useRef<(() => Promise<void>) | null>(null);
  const outboxTailRef = useRef<Promise<void>>(Promise.resolve());
  const localUpdatesAwaitingAckRef = useRef(0);
  const localChangeRevisionRef = useRef(0);
  const inFlightPersistenceRef = useRef(new Map<string, Promise<void>>());
  const hasLocalSnapshotRef = useRef(false);
  const snapshotSaveTimerRef = useRef<number | null>(null);
  const snapshotSaveTailRef = useRef<Promise<void>>(Promise.resolve());

  const updateSaveStatus = (status: 'saved' | 'saving' | 'unsaved') => {
    const statusWithPendingSync = status === 'saved' && localUpdatesAwaitingAckRef.current > 0 ? 'unsaved' : status;
    setSaveStatus(statusWithPendingSync);
    onSaveStatusChange?.(statusWithPendingSync);
  };
  const [autoMask, setAutoMask] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportResult, setExportResult] = useState<any | null>(null);

  const [collabDoc, setCollabDoc] = useState<Y.Doc | null>(null);
  const collabDocRef = useRef<Y.Doc | null>(null);
  const appliedUpdateIdsRef = useRef<Set<string>>(new Set());
  const REMOTE_ORIGIN = useMemo(() => ({}), []);

  // Auto-masking regex for credit cards (13-19 digits) and account numbers
  const maskSensitiveNumbers = (text: string) => {
    return text.replace(/\b(?:\d[ -]*?){13,19}\b/g, (match) => {
      const clean = match.replace(/\D/g, '');
      return `${clean.slice(0, 4)}••••••••${clean.slice(-4)}`;
    });
  };

  // Code documents use Y.Text. Apply the changed range so concurrent typing
  // produces CRDT insert/delete operations instead of replacing whole snapshots.
  const handleContentChange = (newContent: string) => {
    plaintextRef.current = newContent;
    setPlaintext(newContent);
    updateSaveStatus('unsaved');
    if (doc?.doc_type === 'code' && collabDocRef.current) {
      const sharedText = collabDocRef.current.getText('code');
      const oldValue = sharedText.toString();
      let prefix = 0;
      while (prefix < oldValue.length && prefix < newContent.length && oldValue[prefix] === newContent[prefix]) prefix++;
      let suffix = 0;
      while (suffix < oldValue.length - prefix && suffix < newContent.length - prefix &&
        oldValue[oldValue.length - 1 - suffix] === newContent[newContent.length - 1 - suffix]) suffix++;
      collabDocRef.current.transact(() => {
        const deleteCount = oldValue.length - prefix - suffix;
        if (deleteCount) sharedText.delete(prefix, deleteCount);
        const insertion = newContent.slice(prefix, newContent.length - suffix);
        if (insertion) sharedText.insert(prefix, insertion);
      });
    }
  };

  const editorExtensions = useMemo(() => {
    const extensions = [StarterKit.configure({ history: false })];
    if (collabDoc) extensions.push(Collaboration.configure({ document: collabDoc }) as any);
    return extensions;
  }, [collabDoc]);

  const editor = useEditor({
    extensions: editorExtensions,
    editable: !isLocked && currentUserRole !== 'viewer' && !isDecrypting && !!collabDoc,
  }, [collabDoc]);

  const loadYDoc = async (history: { updates: Array<{ update_id: string; encrypted_payload: string }> }) => {
    const ydoc = new Y.Doc();
    for (const item of history.updates) {
      const plain = await decryptEnvelope(item.encrypted_payload, roomKey!);
      Y.applyUpdate(ydoc, base64ToBytes(plain), REMOTE_ORIGIN);
      appliedUpdateIdsRef.current.add(item.update_id);
    }
    return ydoc;
  };

  // Restore the room/document CRDT log. Exactly one joining editor claims the
  // initial state; simultaneous first joins reload the winning encrypted seed.
  useEffect(() => {
    let active = true;
    setCollabDoc(null);
    collabDocRef.current?.destroy();
    collabDocRef.current = null;
    appliedUpdateIdsRef.current.clear();
    hasLocalSnapshotRef.current = false;
    if (snapshotSaveTimerRef.current) window.clearTimeout(snapshotSaveTimerRef.current);
    const prepare = async () => {
      if (!doc || !roomKey || !roomCode) return;
      setIsDecrypting(true);
      try {
        let history: Awaited<ReturnType<typeof api.listCollaborationUpdates>>;
        let ydoc: Y.Doc | null = null;
        let restoredOffline = false;
        try {
          history = await api.listCollaborationUpdates(roomCode, doc.id);
        } catch (error: any) {
          // Authorization and deleted-room responses are authoritative. Only a
          // transport failure may fall back to the encrypted device cache.
          if (error?.status !== undefined) throw error;
          const localSnapshot = await collaborationOutbox.getSnapshot(roomCode, doc.id);
          if (!localSnapshot) throw error;
          ydoc = new Y.Doc();
          history = { initialized: true, updated_at: null, updates: [] };
          restoredOffline = true;
          setSyncStatus('offline');
          setSyncError('The server is offline. Restored the last encrypted local document state.');
        }
        if (!ydoc && history.initialized && !history.updates.length) {
          throw new Error('Collaboration history is marked initialized but is missing its saved seed. Document was not modified.');
        }
        if (!ydoc && history.initialized) {
          ydoc = await loadYDoc(history);
        } else if (!ydoc) {
          let envelope = doc.encrypted_envelope;
          if (!envelope && doc.has_content) {
            const fullDoc = await api.getDocument(roomCode, doc.id);
            envelope = fullDoc?.encrypted_envelope;
          }
          let initialContent = envelope ? await decryptEnvelope(envelope, roomKey) :
            (doc.doc_type === 'code'
              ? `// VaultRoom Secure Code Document\n// File: ${doc.title}\n// Language: ${doc.language || 'typescript'}\n\nexport async function secureHandler() {\n  console.log("End-to-end encrypted execution context.");\n}\n`
              : `<h1>${doc.title}</h1><p>Start collaborating securely in this end-to-end encrypted document.</p>`);
          if (doc.doc_type === 'code') {
            ydoc = new Y.Doc();
            ydoc.getText('code').insert(0, initialContent);
          } else {
            const seedEditor = new Editor({
              element: window.document.createElement('div'),
              extensions: [StarterKit.configure({ history: false })],
              content: initialContent,
            });
            ydoc = prosemirrorJSONToYDoc(seedEditor.schema, seedEditor.getJSON(), 'default');
            seedEditor.destroy();
          }
          const seed = JSON.stringify(await encryptEnvelope(bytesToBase64(Y.encodeStateAsUpdate(ydoc)), roomKey));
          const initialized = await api.initializeCollaboration(roomCode, doc.id, crypto.randomUUID(), seed);
          if (!initialized.initialized) {
            ydoc.destroy();
            history = await api.listCollaborationUpdates(roomCode, doc.id);
            ydoc = await loadYDoc(history);
          } else {
            setLastSyncedAt(new Date().toISOString());
          }
        }
        const localSnapshot = await collaborationOutbox.getSnapshot(roomCode, doc.id);
        hasLocalSnapshotRef.current = !!localSnapshot;
        if (localSnapshot) {
          const cachedState = await decryptEnvelope(localSnapshot, roomKey);
          Y.applyUpdate(ydoc!, base64ToBytes(cachedState), REMOTE_ORIGIN);
        }
        const pending = await collaborationOutbox.list(roomCode, doc.id);
        localUpdatesAwaitingAckRef.current = pending.length;
        for (const item of pending) {
          if (appliedUpdateIdsRef.current.has(item.updateId)) continue;
          const plain = await decryptEnvelope(item.encryptedPayload, roomKey);
          Y.applyUpdate(ydoc!, base64ToBytes(plain), REMOTE_ORIGIN);
          appliedUpdateIdsRef.current.add(item.updateId);
        }
        if (!active) { ydoc.destroy(); return; }
        collabDocRef.current = ydoc;
        if (doc.doc_type === 'code') {
          const restoredText = ydoc.getText('code').toString();
          plaintextRef.current = restoredText;
          setPlaintext(restoredText);
        }
        setLastSyncedAt((current) => current ?? history.updated_at ?? null);
        setSyncStatus(pending.length ? 'unsaved' : restoredOffline ? 'offline' : 'synced');
        if (pending.length) updateSaveStatus('unsaved');
        setCollabDoc(ydoc);
        setIsDecrypting(false);
        updateSaveStatus('saved');
      } catch (err) {
        if (active) { console.error('[Editor] Failed to restore collaboration state:', err); setPlaintext('Unable to load the encrypted collaboration state.'); setIsDecrypting(false); updateSaveStatus('unsaved'); }
      }
    };
    void prepare();
    return () => {
      active = false;
      if (snapshotSaveTimerRef.current) window.clearTimeout(snapshotSaveTimerRef.current);
      collabDocRef.current?.destroy();
      collabDocRef.current = null;
    };
  }, [doc?.id, roomCode, roomKey]);

  // Code editors are rendered from the same Y.Text that receives remote updates.
  useEffect(() => {
    if (!collabDoc || doc?.doc_type !== 'code') return;
    const sharedText = collabDoc.getText('code');
    const updatePlaintext = () => {
      const nextText = sharedText.toString();
      const previousText = plaintextRef.current;
      if (nextText === previousText) return;
      const textarea = codeTextareaRef.current;
      if (textarea && window.document.activeElement === textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        let prefix = 0;
        while (prefix < previousText.length && prefix < nextText.length && previousText[prefix] === nextText[prefix]) prefix++;
        let suffix = 0;
        while (suffix < previousText.length - prefix && suffix < nextText.length - prefix &&
          previousText[previousText.length - 1 - suffix] === nextText[nextText.length - 1 - suffix]) suffix++;
        const mapPosition = (position: number) => position <= prefix
          ? position
          : position >= previousText.length - suffix
            ? Math.max(prefix, position + nextText.length - previousText.length)
            : nextText.length - suffix;
        const nextStart = mapPosition(start);
        const nextEnd = mapPosition(end);
        requestAnimationFrame(() => {
          if (window.document.activeElement === textarea) textarea.setSelectionRange(nextStart, nextEnd);
        });
      }
      plaintextRef.current = nextText;
      setPlaintext(nextText);
    };
    sharedText.observe(updatePlaintext);
    updatePlaintext();
    return () => sharedText.unobserve(updatePlaintext);
  }, [collabDoc, doc?.doc_type]);

  const updateOutboxStatus = async (persistedAt?: string | null) => {
    if (!doc) return;
    const pending = await collaborationOutbox.list(roomCode, doc.id);
    const pendingCount = Math.max(pending.length, localUpdatesAwaitingAckRef.current);
    if (persistedAt) setLastSyncedAt(persistedAt);
    if (!pendingCount && !syncPromiseRef.current) {
      setSyncStatus(connectionState === 'connected' ? 'synced' : 'offline');
      setSyncError(null);
      if (connectionState === 'connected') {
        updateSaveStatus('saved');
        void clearLocalSnapshotIfSynced().catch((error) => console.warn('[Editor] Could not clear confirmed local cache:', error));
      }
    } else if (pendingCount) {
      setSyncStatus(syncErrorRef.current ? 'failed' : 'unsaved');
      updateSaveStatus('unsaved');
    }
  };

  const saveLocalStateSnapshot = () => {
    const saveTask = snapshotSaveTailRef.current.then(async () => {
      const currentDoc = collabDocRef.current;
      if (!currentDoc || !roomKey || !doc) throw new Error('Cannot preserve the local Yjs state');
      const envelope = await encryptEnvelope(bytesToBase64(Y.encodeStateAsUpdate(currentDoc)), roomKey);
      await collaborationOutbox.putSnapshot(roomCode, doc.id, JSON.stringify(envelope));
      hasLocalSnapshotRef.current = true;
    });
    snapshotSaveTailRef.current = saveTask.catch((error) => {
      hasLocalSnapshotRef.current = false;
      setSyncError(error?.message || 'Could not preserve an encrypted offline document copy.');
      setSyncStatus('failed');
    });
    return saveTask;
  };

  const scheduleLocalStateSnapshot = () => {
    if (snapshotSaveTimerRef.current) window.clearTimeout(snapshotSaveTimerRef.current);
    if (!hasLocalSnapshotRef.current) {
      hasLocalSnapshotRef.current = true;
      return saveLocalStateSnapshot();
    }
    snapshotSaveTimerRef.current = window.setTimeout(() => {
      snapshotSaveTimerRef.current = null;
      void saveLocalStateSnapshot();
    }, 300);
    return Promise.resolve();
  };

  const clearLocalSnapshotIfSynced = async () => {
    if (!doc) return;
    if (snapshotSaveTimerRef.current) {
      window.clearTimeout(snapshotSaveTimerRef.current);
      snapshotSaveTimerRef.current = null;
    }
    await snapshotSaveTailRef.current;
    if (localUpdatesAwaitingAckRef.current > 0) return;
    if ((await collaborationOutbox.list(roomCode, doc.id)).length) return;
    await collaborationOutbox.removeSnapshot(roomCode, doc.id);
    if (localUpdatesAwaitingAckRef.current === 0) hasLocalSnapshotRef.current = false;
  };

  // Local CRDT updates are encrypted and stored locally before network send.
  useEffect(() => {
    if (!collabDoc || !doc || !roomKey) return;
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN) return;
      const updateId = crypto.randomUUID();
      setSyncError(null);
      setSyncStatus('unsaved');
      updateSaveStatus('unsaved');
      localChangeRevisionRef.current += 1;
      localUpdatesAwaitingAckRef.current += 1;
      const snapshotReady = scheduleLocalStateSnapshot();
      const persistTask = outboxTailRef.current.then(async () => {
        const envelope = await encryptEnvelope(bytesToBase64(update), roomKey);
        const encryptedPayload = JSON.stringify(envelope);
        await collaborationOutbox.put({
          roomCode: roomCode.toUpperCase(), documentId: doc.id, updateId,
          encryptedPayload, createdAt: Date.now(),
        });
        await snapshotReady;
        if (connectionState !== 'connected') return;
        const sendTask = (async () => {
          try {
            const persistedAt = await onBroadcastDelta(doc.id, updateId, encryptedPayload);
            await collaborationOutbox.remove(roomCode, doc.id, updateId);
            localUpdatesAwaitingAckRef.current = Math.max(0, localUpdatesAwaitingAckRef.current - 1);
            await updateOutboxStatus(persistedAt);
          } catch (error: any) {
            setSyncError(error?.message || 'The server has not confirmed this change. It is saved encrypted for retry.');
            setSyncStatus('failed');
          }
        })();
        inFlightPersistenceRef.current.set(updateId, sendTask);
        void sendTask.finally(() => inFlightPersistenceRef.current.delete(updateId));
      }).catch((error: any) => {
        console.error('[Editor] Could not preserve an encrypted collaboration update:', error);
        setSyncError(error?.message || 'Could not preserve this change for synchronization.');
        setSyncStatus('failed');
      });
      outboxTailRef.current = persistTask;
    };
    collabDoc.on('update', onUpdate);
    return () => { collabDoc.off('update', onUpdate); };
  }, [collabDoc, doc?.id, roomCode, roomKey, connectionState, onBroadcastDelta, onSaveStatusChange, REMOTE_ORIGIN]);

  useEffect(() => {
    if (!collabDoc || !roomKey || !doc || !remoteDeltas?.length) return;
    for (const delta of remoteDeltas) {
      if (delta.document_id !== doc.id || !delta.update_id || appliedUpdateIdsRef.current.has(delta.update_id)) continue;
      appliedUpdateIdsRef.current.add(delta.update_id);
      if (appliedUpdateIdsRef.current.size > 2000) {
        const oldest = appliedUpdateIdsRef.current.values().next().value;
        if (oldest) appliedUpdateIdsRef.current.delete(oldest);
      }
      void decryptEnvelope(delta.encrypted_payload, roomKey)
        .then((plain) => Y.applyUpdate(collabDoc, base64ToBytes(plain), REMOTE_ORIGIN))
        .catch((error) => {
          appliedUpdateIdsRef.current.delete(delta.update_id);
          console.error('[Editor] Failed to apply encrypted Yjs update:', error);
        });
    }
  }, [collabDoc, remoteDeltas, doc?.id, roomKey, REMOTE_ORIGIN]);

  const handleSyncNow = async () => {
    if (syncPromiseRef.current) return syncPromiseRef.current;
    if (!collabDoc || !doc || !roomKey) throw new Error('The encrypted document is not ready to sync');
    if (connectionState !== 'connected') {
      const pendingLocalChanges = localUpdatesAwaitingAckRef.current > 0;
      setSyncStatus(connectionState === 'reconnecting' || connectionState === 'connecting'
        ? 'reconnecting'
        : pendingLocalChanges ? 'unsaved' : 'offline');
      setSyncError('Connect to the room before retrying. Encrypted edits are retained on this device.');
      throw new Error('This room is offline. Encrypted edits remain available for retry.');
    }
    const operation = (async () => {
      setSyncStatus('syncing');
      setSyncError(null);
      try {
        await outboxTailRef.current;
        await Promise.all([...inFlightPersistenceRef.current.values()]);
        const result = await synchronizeYDoc({
          roomCode,
          documentId: doc.id,
          localDoc: collabDoc,
          outbox: collaborationOutbox,
          listServerHistory: () => api.listCollaborationUpdates(roomCode, doc.id),
          publishPersisted: (updateId, encryptedPayload) => onBroadcastDelta(doc.id, updateId, encryptedPayload),
          encryptUpdate: async (update) => JSON.stringify(await encryptEnvelope(bytesToBase64(update), roomKey)),
          decryptUpdate: async (payload) => base64ToBytes(await decryptEnvelope(payload, roomKey)),
          applyServerUpdate: (updateId, update) => {
            Y.applyUpdate(collabDoc, update, REMOTE_ORIGIN);
            appliedUpdateIdsRef.current.add(updateId);
          },
          hasAppliedUpdate: (updateId) => appliedUpdateIdsRef.current.has(updateId),
        });
        await outboxTailRef.current;
        const revision = localChangeRevisionRef.current;
        const pending = await collaborationOutbox.list(roomCode, doc.id);
        const noConcurrentLocalEdit = revision === localChangeRevisionRef.current;
        if (noConcurrentLocalEdit) localUpdatesAwaitingAckRef.current = pending.length;
        const pendingCount = Math.max(pending.length, localUpdatesAwaitingAckRef.current);
        if (result.lastSyncedAt) setLastSyncedAt(result.lastSyncedAt);
        if (pendingCount || !noConcurrentLocalEdit) {
          setSyncStatus('unsaved');
          updateSaveStatus('unsaved');
        } else {
          setSyncStatus('synced');
          setSyncError(null);
          updateSaveStatus('saved');
          void clearLocalSnapshotIfSynced().catch((error) => console.warn('[Editor] Could not clear confirmed local cache:', error));
        }
      } catch (error: any) {
        const pending = await collaborationOutbox.list(roomCode, doc.id).catch(() => []);
        setSyncStatus('failed');
        setSyncError(error?.message || 'Synchronization failed. Retry to preserve and merge your changes.');
        updateSaveStatus('unsaved');
        throw error;
      }
    })();
    syncPromiseRef.current = operation;
    try {
      await operation;
    } finally {
      syncPromiseRef.current = null;
    }
  };

  syncNowRef.current = handleSyncNow;

  useEffect(() => {
    if (!collabDoc || !doc || !roomKey) return;
    if (connectionState === 'connected') {
      void syncNowRef.current?.().catch(() => undefined);
    } else if (connectionState === 'reconnecting' || connectionState === 'connecting') {
      setSyncStatus('reconnecting');
    } else {
      void collaborationOutbox.list(roomCode, doc.id).then((pending) => {
        setSyncStatus(pending.length ? 'unsaved' : 'offline');
      }).catch((error) => {
        setSyncStatus('failed');
        setSyncError(error?.message || 'Offline sync storage could not be read.');
      });
    }
  }, [collabDoc, connectionState, doc?.id, roomCode, roomKey]);

  // Save now means persist the Yjs state and reconcile it with server history.
  const handleSave = async () => {
    if (!doc || !roomKey || saveStatus === 'saving') return;
    updateSaveStatus('saving');
    try {
      await handleSyncNow();
      updateSaveStatus('saved');
    } catch {
      updateSaveStatus('unsaved');
    }
  };

  // Watermarked Export
  const handleExport = async (format = 'markdown') => {
    if (!doc) return;
    setExporting(true);
    try {
      const res = await api.exportDocument(roomCode, doc.id, format);
      setExportResult(res);

      // Create downloadable file with embedded watermark
      const content = doc.doc_type === 'code' ? plaintext : (editor ? editor.getText() : plaintext);
      const watermarkedContent = `/* ${res.watermark} */\n\n${content}`;
      const blob = new Blob([watermarkedContent], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc.title.replace(/\s+/g, '_')}_${res.export_id}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      alert(`Export blocked: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  if (!doc) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0a0b10] text-slate-500 p-8">
        <FileCode className="w-12 h-12 text-[#1c2235] mb-3" />
        <p className="text-sm font-mono">No document selected</p>
        <p className="text-xs text-slate-600 mt-1">Select an existing document from the left panel or create a new file.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-3.5rem)] bg-[#0a0b10] overflow-hidden">
      {/* Document Control Header */}
      <div className="h-11 px-4 border-b border-[#212638] bg-[#0c0e16] flex items-center justify-between select-none">
        <div className="flex items-center space-x-3">
          <span className="font-mono text-xs font-semibold text-slate-200">{doc.title}</span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#161a29] text-cyan-400 border border-[#212638]">
            {doc.doc_type === 'code' ? `${doc.language || 'Code'}` : 'Markdown Rich-Text'}
          </span>
          {doc.is_protected && (
            <span className="flex items-center space-x-1 text-[10px] font-mono px-2 py-0.5 rounded bg-amber-950/60 border border-amber-800/40 text-amber-300">
              <Lock className="w-3 h-3" />
              <span>Threshold Protected</span>
            </span>
          )}
        </div>

        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1.5 px-2 py-1 rounded bg-[#121522] border border-[#212638] text-[11px] font-mono" title={syncError || undefined} aria-live="polite">
            <span className={`w-2 h-2 rounded-full ${
              syncStatus === 'synced' ? 'bg-emerald-400' :
              syncStatus === 'syncing' || syncStatus === 'reconnecting' ? 'bg-amber-400 animate-pulse' :
              syncStatus === 'failed' ? 'bg-red-400' : 'bg-amber-500'
            }`} />
            <span className={syncStatus === 'failed' ? 'text-red-300' : 'text-slate-300'}>
              {syncStatus === 'synced' ? 'Synced' :
                syncStatus === 'syncing' ? 'Syncing…' :
                  syncStatus === 'reconnecting' ? 'Reconnecting…' :
                    syncStatus === 'offline' ? 'Offline' :
                      syncStatus === 'failed' ? 'Sync failed — Retry' : 'Unsaved changes'}
            </span>
            {lastSyncedAt && syncStatus === 'synced' && (
              <span className="hidden xl:inline text-slate-500">{new Date(lastSyncedAt).toLocaleTimeString()}</span>
            )}
          </div>
          {syncStatus === 'failed' && syncError && (
            <span className="hidden lg:inline max-w-56 truncate text-[10px] text-red-300" role="alert" title={syncError}>
              {syncError}
            </span>
          )}

          <button
            onClick={() => { void handleSyncNow().catch(() => undefined); }}
            disabled={!collabDoc || syncStatus === 'syncing'}
            title={syncError || 'Save local edits and merge the latest persisted room state'}
            aria-label="Sync Now"
            className="px-2.5 py-1 rounded bg-[#1c2236] hover:bg-[#252d47] border border-[#2a3350] disabled:opacity-50 text-xs font-mono text-slate-200 transition-colors flex items-center space-x-1"
          >
            <RefreshCw className={`w-3 h-3 text-cyan-400 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`} />
            <span>Sync Now</span>
          </button>

          {/* Auto-Masking Toggle */}
          <button
            onClick={() => setAutoMask(!autoMask)}
            title="Toggle sensitive number masking (PCI/Account masking)"
            className={`px-2.5 py-1 rounded text-xs font-mono border flex items-center space-x-1 transition-colors ${
              autoMask
                ? 'bg-cyan-950/70 border-cyan-500 text-cyan-300'
                : 'bg-[#121522] border-[#212638] text-slate-400 hover:text-slate-200'
            }`}
          >
            {autoMask ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            <span className="hidden sm:inline">Auto-Mask</span>
          </button>

          {/* Manual Encrypt & Save Button */}
          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving' || isLocked}
            className="px-2.5 py-1 rounded bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-slate-950 font-semibold text-xs font-mono transition-colors flex items-center space-x-1"
          >
            <Save className="w-3 h-3" />
            <span>Save</span>
          </button>

          {/* Watermarked Export */}
          <button
            onClick={() => handleExport('markdown')}
            disabled={exporting || isLocked}
            title="Export with forensic watermark and tracking token"
            className="px-2.5 py-1 rounded bg-[#1c2236] hover:bg-[#252d47] border border-[#2a3350] text-xs font-mono text-slate-200 transition-colors flex items-center space-x-1"
          >
            <Download className="w-3 h-3 text-cyan-400" />
            <span className="hidden sm:inline">Export</span>
          </button>
        </div>
      </div>

      {/* TipTap Formatting Toolbar (Only in Document Mode) */}
      {doc.doc_type === 'document' && editor && (
        <div className="h-9 px-4 border-b border-[#1b1f30] bg-[#090a10] flex items-center space-x-1 select-none">
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            className={`p-1.5 rounded hover:bg-[#181d2e] ${
              editor.isActive('bold') ? 'text-cyan-400 bg-[#161a29]' : 'text-slate-400'
            }`}
            title="Bold"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            className={`p-1.5 rounded hover:bg-[#181d2e] ${
              editor.isActive('italic') ? 'text-cyan-400 bg-[#161a29]' : 'text-slate-400'
            }`}
            title="Italic"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={`p-1.5 rounded hover:bg-[#181d2e] ${
              editor.isActive('heading', { level: 1 }) ? 'text-cyan-400 bg-[#161a29]' : 'text-slate-400'
            }`}
            title="Heading 1"
          >
            <Heading1 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`p-1.5 rounded hover:bg-[#181d2e] ${
              editor.isActive('heading', { level: 2 }) ? 'text-cyan-400 bg-[#161a29]' : 'text-slate-400'
            }`}
            title="Heading 2"
          >
            <Heading2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`p-1.5 rounded hover:bg-[#181d2e] ${
              editor.isActive('bulletList') ? 'text-cyan-400 bg-[#161a29]' : 'text-slate-400'
            }`}
            title="Bullet List"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className={`p-1.5 rounded hover:bg-[#181d2e] ${
              editor.isActive('codeBlock') ? 'text-cyan-400 bg-[#161a29]' : 'text-slate-400'
            }`}
            title="Code Block"
          >
            <Code className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Editing Canvas */}
      <div className="flex-1 overflow-y-auto p-6 md:p-8">
        {isDecrypting ? (
          <div className="flex items-center space-x-2 text-cyan-400 text-xs font-mono py-12 justify-center">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
            <span>Decrypting document envelope with Web Crypto AES-256-GCM...</span>
          </div>
        ) : doc.doc_type === 'code' ? (
          /* Code Editing Area */
          <div className="h-full flex flex-col">
            <textarea
              ref={codeTextareaRef}
              value={autoMask ? maskSensitiveNumbers(plaintext) : plaintext}
              onChange={(e) => handleContentChange(e.target.value)}
              disabled={isLocked || isDecrypting || !collabDoc || currentUserRole === 'viewer'}
              className="flex-1 w-full bg-[#0a0c13] font-mono text-sm leading-relaxed text-cyan-300 p-4 rounded-lg border border-[#1f2438] focus:outline-none focus:border-cyan-500/50 resize-none"
              spellCheck={false}
            />
          </div>
        ) : (
          /* TipTap Rich Text Area */
          <div className="max-w-4xl mx-auto">
            <EditorContent editor={editor} />
          </div>
        )}
      </div>
    </div>
  );
};
