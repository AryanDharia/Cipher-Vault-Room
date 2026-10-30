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
  CheckCircle,
  Eye,
  EyeOff,
  FileCode,
  Sparkles
} from 'lucide-react';
import { encryptEnvelope, decryptEnvelope } from '../lib/crypto';
import { api } from '../lib/api';

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
  onSaveDocument: (docId: string, encryptedEnvelope: string) => Promise<void>;
  onBroadcastDelta: (docId: string, updateId: string, encryptedPayload: string) => void;
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
  onSaveDocument,
  onBroadcastDelta,
  onSaveStatusChange,
  remoteDeltas,
  connectionState,
}) => {
  const [plaintext, setPlaintext] = useState<string>('');
  const [isDecrypting, setIsDecrypting] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');

  const updateSaveStatus = (status: 'saved' | 'saving' | 'unsaved') => {
    setSaveStatus(status);
    onSaveStatusChange?.(status);
  };
  const [autoMask, setAutoMask] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportResult, setExportResult] = useState<any | null>(null);

  const [collabDoc, setCollabDoc] = useState<Y.Doc | null>(null);
  const collabDocRef = useRef<Y.Doc | null>(null);
  const appliedUpdateIdsRef = useRef<Set<string>>(new Set());
  const autoSaveTimerRef = useRef<number | null>(null);
  const REMOTE_ORIGIN = useMemo(() => ({}), []);

  // Auto-masking regex for credit cards (13-19 digits) and account numbers
  const maskSensitiveNumbers = (text: string) => {
    return text.replace(/\b(?:\d[ -]*?){13,19}\b/g, (match) => {
      const clean = match.replace(/\D/g, '');
      return `${clean.slice(0, 4)}••••••••${clean.slice(-4)}`;
    });
  };

  const scheduleSnapshotSave = (newContent: string) => {
    if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = window.setTimeout(async () => {
      if (!roomKey || !doc) return;
      try {
        updateSaveStatus('saving');
        const content = doc.doc_type === 'code'
          ? (collabDocRef.current?.getText('code').toString() ?? newContent)
          : (editor?.getHTML() ?? newContent);
        const envelope = await encryptEnvelope(content, roomKey);
        await onSaveDocument(doc.id, JSON.stringify(envelope));
        updateSaveStatus('saved');
      } catch {
        updateSaveStatus('unsaved');
      }
    }, 1500);
  };

  // Code documents use Y.Text. Apply the changed range so concurrent typing
  // produces CRDT insert/delete operations instead of replacing whole snapshots.
  const handleContentChange = (newContent: string) => {
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
    scheduleSnapshotSave(newContent);
  };

  const editorExtensions = useMemo(() => {
    const extensions = [StarterKit.configure({ history: false })];
    if (collabDoc) extensions.push(Collaboration.configure({ document: collabDoc }) as any);
    return extensions;
  }, [collabDoc]);

  const editor = useEditor({
    extensions: editorExtensions,
    editable: !isLocked && currentUserRole !== 'viewer',
    onUpdate: ({ editor }) => {
      if (doc?.doc_type === 'document') {
        updateSaveStatus('unsaved');
        scheduleSnapshotSave(editor.getHTML());
      }
    },
  }, [collabDoc]);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

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
    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    setCollabDoc(null);
    collabDocRef.current?.destroy();
    collabDocRef.current = null;
    appliedUpdateIdsRef.current.clear();
    const prepare = async () => {
      if (!doc || !roomKey || !roomCode) return;
      setIsDecrypting(true);
      try {
        let history = await api.listCollaborationUpdates(roomCode, doc.id);
        let ydoc: Y.Doc;
        if (history.initialized && !history.updates.length) {
          throw new Error('Collaboration history is marked initialized but is missing its saved seed. Document was not modified.');
        }
        if (history.initialized) {
          ydoc = await loadYDoc(history);
        } else {
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
          }
        }
        if (!active) { ydoc.destroy(); return; }
        collabDocRef.current = ydoc;
        if (doc.doc_type === 'code') setPlaintext(ydoc.getText('code').toString());
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
      collabDocRef.current?.destroy();
      collabDocRef.current = null;
    };
  }, [doc?.id, roomCode, roomKey]);

  // Local CRDT updates are encrypted and persisted/broadcast as independent events.
  useEffect(() => {
    if (!collabDoc || !doc || !roomKey) return;
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN) return;
      const updateId = crypto.randomUUID();
      void encryptEnvelope(bytesToBase64(update), roomKey)
        .then((envelope) => onBroadcastDelta(doc.id, updateId, JSON.stringify(envelope)))
        .catch((error) => console.error('[Editor] Failed to encrypt a collaboration update:', error));
    };
    collabDoc.on('update', onUpdate);
    return () => { collabDoc.off('update', onUpdate); };
  }, [collabDoc, doc?.id, roomKey, onBroadcastDelta]);

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
        .catch((error) => console.error('[Editor] Failed to apply encrypted Yjs update:', error));
    }
  }, [collabDoc, remoteDeltas, doc?.id, roomKey, REMOTE_ORIGIN]);

  // Resend the merged state after reconnect; Yjs applies duplicate state updates idempotently.
  useEffect(() => {
    if (!collabDoc || !doc || !roomKey || connectionState !== 'connected') return;
    const updateId = crypto.randomUUID();
    void encryptEnvelope(bytesToBase64(Y.encodeStateAsUpdate(collabDoc)), roomKey)
      .then((envelope) => onBroadcastDelta(doc.id, updateId, JSON.stringify(envelope)))
      .catch((error) => console.error('[Editor] Failed to send collaboration state after reconnect:', error));
  }, [collabDoc, connectionState, doc?.id, roomKey, onBroadcastDelta]);

  // Encrypt & Save Document
  const handleSave = async () => {
    if (!doc || !roomKey || saveStatus === 'saving') return;
    updateSaveStatus('saving');

    if (autoSaveTimerRef.current) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    try {
      const currentContent = doc.doc_type === 'code' ? plaintext : (editor ? editor.getHTML() : plaintext);
      const envelope = await encryptEnvelope(currentContent, roomKey);
      const envelopeStr = JSON.stringify(envelope);

      await onSaveDocument(doc.id, envelopeStr);
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
          {/* Real Save & Encryption Status */}
          <div className="flex items-center space-x-1.5 px-2 py-1 rounded bg-[#121522] border border-[#212638] text-[11px] font-mono">
            <span
              className={`w-2 h-2 rounded-full ${
                saveStatus === 'saved'
                  ? 'bg-emerald-400'
                  : saveStatus === 'saving'
                  ? 'bg-amber-400 animate-spin'
                  : 'bg-amber-500'
              }`}
            />
            <span className="text-slate-300">
              {saveStatus === 'saved'
                ? 'Encrypted & Synced'
                : saveStatus === 'saving'
                ? 'Encrypting...'
                : 'Unsaved Changes'}
            </span>
          </div>

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
              value={autoMask ? maskSensitiveNumbers(plaintext) : plaintext}
              onChange={(e) => handleContentChange(e.target.value)}
              disabled={isLocked || currentUserRole === 'viewer'}
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
