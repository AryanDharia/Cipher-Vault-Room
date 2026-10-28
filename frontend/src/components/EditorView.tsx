import React, { useEffect, useState, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
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
import { encryptEnvelope, decryptEnvelope, EncryptedEnvelope } from '../lib/crypto';
import { api } from '../lib/api';

interface EditorViewProps {
  document: any;
  roomCode: string;
  roomKey: CryptoKey | null;
  isLocked: boolean;
  currentUserRole: string;
  onSaveDocument: (docId: string, encryptedEnvelope: string) => Promise<void>;
  onBroadcastDelta: (docId: string, encryptedPayload: string) => void;
  latestDelta?: any;
  remoteDeltas?: any[];
}

export const EditorView: React.FC<EditorViewProps> = ({
  document: doc,
  roomCode,
  roomKey,
  isLocked,
  currentUserRole,
  onSaveDocument,
  onBroadcastDelta,
  latestDelta,
  remoteDeltas,
}) => {
  const [plaintext, setPlaintext] = useState<string>('');
  const [isDecrypting, setIsDecrypting] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [autoMask, setAutoMask] = useState<boolean>(false);
  const [exporting, setExporting] = useState<boolean>(false);
  const [exportResult, setExportResult] = useState<any | null>(null);

  // References to prevent broadcast echo loops and debounce network updates
  const isRemoteUpdateRef = useRef<boolean>(false);
  const broadcastTimerRef = useRef<number | null>(null);
  const autoSaveTimerRef = useRef<number | null>(null);

  // Auto-masking regex for credit cards (13-19 digits) and account numbers
  const maskSensitiveNumbers = (text: string) => {
    return text.replace(/\b(?:\d[ -]*?){13,19}\b/g, (match) => {
      const clean = match.replace(/\D/g, '');
      return `${clean.slice(0, 4)}••••••••${clean.slice(-4)}`;
    });
  };

  // Setup TipTap Editor with instant real-time collaborative broadcast
  const editor = useEditor({
    extensions: [StarterKit],
    content: plaintext,
    editable: !isLocked && currentUserRole !== 'viewer',
    onUpdate: ({ editor }) => {
      // If the content change was injected from a remote collaborator, do NOT re-broadcast!
      if (isRemoteUpdateRef.current) return;

      const html = editor.getHTML();
      setPlaintext(html);
      setSaveStatus('unsaved');

      // 1. FAST REAL-TIME BROADCAST: 120ms debounce delivers keystrokes to peers instantly
      if (broadcastTimerRef.current) {
        window.clearTimeout(broadcastTimerRef.current);
      }
      broadcastTimerRef.current = window.setTimeout(async () => {
        if (!roomKey || !doc) return;
        try {
          const envelope = await encryptEnvelope(html, roomKey);
          onBroadcastDelta(doc.id, JSON.stringify(envelope));
        } catch {
          // Encryption or broadcast skipped
        }
      }, 120);

      // 2. PERSISTENT BACKGROUND AUTOSAVE: 1500ms debounce saves to database
      if (autoSaveTimerRef.current) {
        window.clearTimeout(autoSaveTimerRef.current);
      }
      autoSaveTimerRef.current = window.setTimeout(async () => {
        if (!roomKey || !doc) return;
        try {
          setSaveStatus('saving');
          const envelope = await encryptEnvelope(html, roomKey);
          await onSaveDocument(doc.id, JSON.stringify(envelope));
          setSaveStatus('saved');
        } catch {
          setSaveStatus('unsaved');
        }
      }, 1500);
    },
  });

  // Cleanup debounce timers on unmount
  useEffect(() => {
    return () => {
      if (broadcastTimerRef.current) window.clearTimeout(broadcastTimerRef.current);
      if (autoSaveTimerRef.current) window.clearTimeout(autoSaveTimerRef.current);
    };
  }, []);

  // Decrypt document when document or roomKey changes
  useEffect(() => {
    let active = true;
    const loadAndDecrypt = async () => {
      if (!doc) return;
      setIsDecrypting(true);

      if (!doc.encrypted_envelope) {
        // Empty document template
        const initial = doc.doc_type === 'code'
          ? `// VaultRoom Secure Code Document\n// File: ${doc.title}\n// Language: ${doc.language || 'typescript'}\n\nexport async function secureHandler() {\n  console.log("End-to-end encrypted execution context.");\n}\n`
          : `<h1>${doc.title}</h1><p>Start collaborating securely in this end-to-end encrypted document.</p>`;
        
        if (active) {
          setPlaintext(initial);
          editor?.commands.setContent(initial);
          setIsDecrypting(false);
          setSaveStatus('saved');
        }
        return;
      }

      if (!roomKey) {
        if (active) {
          setPlaintext('/* Missing document encryption key. Please join room with valid room key. */');
          setIsDecrypting(false);
        }
        return;
      }

      try {
        const decrypted = await decryptEnvelope(doc.encrypted_envelope, roomKey);
        if (active) {
          setPlaintext(decrypted);
          editor?.commands.setContent(decrypted);
          setIsDecrypting(false);
          setSaveStatus('saved');
        }
      } catch (err) {
        if (active) {
          setPlaintext(`<p style="color:#ef4444;">[Decryption Error]: Ciphertext integrity check failed or invalid room key.</p>`);
          setIsDecrypting(false);
        }
      }
    };

    loadAndDecrypt();
    return () => {
      active = false;
    };
  }, [doc?.id, doc?.encrypted_envelope, roomKey, editor]);

  // Handle remote incoming deltas
  useEffect(() => {
    const delta = latestDelta || (remoteDeltas && remoteDeltas.length > 0 ? remoteDeltas[remoteDeltas.length - 1] : null);
    if (!delta || !roomKey || !editor || !doc) return;

    if (delta.document_id === doc.id) {
      decryptEnvelope(delta.encrypted_payload, roomKey).then((incomingText) => {
        const currentContent = editor.getHTML();
        if (incomingText && incomingText !== currentContent) {
          console.log(`[Editor] Applied real-time remote delta for document: ${doc.id}`);
          isRemoteUpdateRef.current = true;
          // In TipTap, passing false as second argument suppresses the onUpdate event
          editor.commands.setContent(incomingText, false);
          setPlaintext(incomingText);
          setSaveStatus('saved');
          setTimeout(() => {
            isRemoteUpdateRef.current = false;
          }, 80);
        }
      }).catch((err) => {
        console.error('[Editor] Failed to decrypt remote delta. Verify room passphrase:', err);
      });
    }
  }, [latestDelta, remoteDeltas, editor, doc?.id, roomKey]);

  // Encrypt & Save Document
  const handleSave = async () => {
    if (!doc || !roomKey || saveStatus === 'saving') return;
    setSaveStatus('saving');

    try {
      const currentContent = editor ? editor.getHTML() : plaintext;
      const envelope = await encryptEnvelope(currentContent, roomKey);
      const envelopeStr = JSON.stringify(envelope);

      await onSaveDocument(doc.id, envelopeStr);
      // Broadcast encrypted delta to other participants
      onBroadcastDelta(doc.id, envelopeStr);
      setSaveStatus('saved');
    } catch {
      setSaveStatus('unsaved');
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
      const content = editor ? editor.getText() : plaintext;
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
              onChange={(e) => {
                setPlaintext(e.target.value);
                setSaveStatus('unsaved');
              }}
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
