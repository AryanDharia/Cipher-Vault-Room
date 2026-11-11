import React, { useState } from 'react';
import {
  FileText,
  Code,
  Plus,
  Trash2,
  Lock,
  Globe,
  BookOpen,
  Key,
  Eye,
  EyeOff,
  Copy,
  Check,
  Search,
  Upload,
  AlertCircle,
  Download,
  FileSpreadsheet,
  FileCode,
  ExternalLink,
  ShieldCheck,
  FolderOpen
} from 'lucide-react';
import { api } from '../lib/api';

interface SidebarProps {
  roomCode: string;
  documents: any[];
  activeDocId: string | null;
  onSelectDoc: (docId: string) => void;
  onCreateDoc: (title: string, docType: string, language?: string) => void;
  onDeleteDoc: (docId: string) => void;
  sources: any[];
  onAddTextSource: (title: string, content: string, sourceType: string) => void;
  onAddUrlSource: (title: string, url: string) => void;
  onUploadSource: (file: File) => void;
  uploadingSource?: boolean;
  onDeleteSource: (sourceId: string) => void;
  onOpenSourcePreview?: (source: any) => void;
  secrets: any[];
  onAddSecret: (name: string, category: string, value: string, desc?: string) => void;
  onRevealSecret: (secretId: string) => Promise<string | null>;
  onDeleteSecret: (secretId: string) => void;
  width?: number;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  roomCode,
  documents,
  activeDocId,
  onSelectDoc,
  onCreateDoc,
  onDeleteDoc,
  sources,
  onAddTextSource,
  onAddUrlSource,
  onUploadSource,
  uploadingSource = false,
  onDeleteSource,
  onOpenSourcePreview,
  secrets,
  onAddSecret,
  onRevealSecret,
  onDeleteSecret,
  width,
}) => {
  const [activeTab, setActiveTab] = useState<'docs' | 'sources' | 'vault'>('docs');
  
  // New Document modal state
  const [showNewDocModal, setShowNewDocModal] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState('');
  const [newDocType, setNewDocType] = useState<'document' | 'code'>('document');
  const [newDocLang, setNewDocLang] = useState('typescript');

  // Source form state
  const [showAddSource, setShowAddSource] = useState(false);
  const [sourceType, setSourceType] = useState<'url' | 'text' | 'file'>('url');
  const [sourceTitle, setSourceTitle] = useState('');
  const [sourceInput, setSourceInput] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');

  // Secret form state
  const [showAddSecret, setShowAddSecret] = useState(false);
  const [secretName, setSecretName] = useState('');
  const [secretVal, setSecretVal] = useState('');
  const [secretCat, setSecretCat] = useState('api_key');
  const [secretDesc, setSecretDesc] = useState('');
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCreateDocSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDocTitle.trim()) return;
    onCreateDoc(newDocTitle.trim(), newDocType, newDocType === 'code' ? newDocLang : 'markdown');
    setNewDocTitle('');
    setShowNewDocModal(false);
  };

  const handleAddSourceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sourceTitle.trim() || !sourceInput.trim()) return;
    if (sourceType === 'url') {
      onAddUrlSource(sourceTitle.trim(), sourceInput.trim());
    } else {
      onAddTextSource(sourceTitle.trim(), sourceInput.trim(), 'text');
    }
    setSourceTitle('');
    setSourceInput('');
    setShowAddSource(false);
  };

  const handleAddSecretSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!secretName.trim() || !secretVal.trim()) return;
    onAddSecret(secretName.trim(), secretCat, secretVal.trim(), secretDesc.trim());
    setSecretName('');
    setSecretVal('');
    setSecretDesc('');
    setShowAddSecret(false);
  };

  const toggleReveal = async (secretId: string) => {
    if (revealedSecrets[secretId]) {
      const next = { ...revealedSecrets };
      delete next[secretId];
      setRevealedSecrets(next);
    } else {
      const val = await onRevealSecret(secretId);
      if (val) {
        setRevealedSecrets({ ...revealedSecrets, [secretId]: val });
      }
    }
  };

  const copySecret = (secretId: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedKey(secretId);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <aside
      style={width !== undefined ? { width: `${width}px`, minWidth: `${width}px` } : undefined}
      className={`border-r border-[rgba(100,220,205,0.14)] bg-[#05090b]/92 backdrop-blur-xl flex flex-col h-full select-none shrink-0 overflow-hidden ${
        width !== undefined ? '' : 'w-72'
      }`}
    >
      {/* Tab Navigation */}
      <div className="flex border-b border-[rgba(100,220,205,0.14)] bg-[#070d10]/95 p-1.5 gap-1.5">
        <button
          onClick={() => setActiveTab('docs')}
          className={`flex-1 py-1.5 text-xs font-mono font-medium rounded-lg flex items-center justify-center space-x-1.5 transition-all ${
            activeTab === 'docs'
              ? 'bg-gradient-to-r from-[#21d4e5]/18 to-[#10bfa5]/14 border border-[#21d4e5]/40 text-[#21d4e5] shadow-[0_0_12px_rgba(33,212,229,0.12)]'
              : 'border border-transparent text-[#91a4a7] hover:text-[#f2f7f7] hover:bg-[#0b1115]'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Files</span>
        </button>
        <button
          onClick={() => setActiveTab('sources')}
          className={`flex-1 py-1.5 text-xs font-mono font-medium rounded-lg flex items-center justify-center space-x-1.5 transition-all ${
            activeTab === 'sources'
              ? 'bg-gradient-to-r from-[#21d4e5]/18 to-[#10bfa5]/14 border border-[#21d4e5]/40 text-[#21d4e5] shadow-[0_0_12px_rgba(33,212,229,0.12)]'
              : 'border border-transparent text-[#91a4a7] hover:text-[#f2f7f7] hover:bg-[#0b1115]'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Sources</span>
        </button>
        <button
          onClick={() => setActiveTab('vault')}
          className={`flex-1 py-1.5 text-xs font-mono font-medium rounded-lg flex items-center justify-center space-x-1.5 transition-all ${
            activeTab === 'vault'
              ? 'bg-gradient-to-r from-[#21d4e5]/18 to-[#10bfa5]/14 border border-[#21d4e5]/40 text-[#21d4e5] shadow-[0_0_12px_rgba(33,212,229,0.12)]'
              : 'border border-transparent text-[#91a4a7] hover:text-[#f2f7f7] hover:bg-[#0b1115]'
          }`}
        >
          <Key className="w-3.5 h-3.5" />
          <span>Locker</span>
        </button>
      </div>

      {/* TAB 1: DOCUMENTS */}
      {activeTab === 'docs' && (
        <div className="flex-1 flex flex-col p-3 overflow-hidden">
          <div className="flex items-center justify-between mb-2.5 px-0.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#91a4a7] font-semibold">
              Workspace Files ({documents.length})
            </span>
            <button
              onClick={() => setShowNewDocModal(true)}
              className="p-1 rounded-lg bg-[#0b1115] hover:bg-[#121c21] border border-[rgba(100,220,205,0.2)] text-[#21d4e5] hover:border-[#21d4e5]/50 transition-all shadow-sm"
              title="Create Document"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-0.5">
            {documents.length === 0 ? (
              <div className="text-center py-12 px-4 rounded-xl border border-dashed border-[rgba(100,220,205,0.14)] bg-[#070d10]/40 text-xs text-[#91a4a7]">
                <FolderOpen className="w-6 h-6 mx-auto mb-2 text-[#91a4a7]/60" />
                No documents in vault yet.<br />Click <span className="text-[#21d4e5]">+</span> to initialize your first encrypted file.
              </div>
            ) : (
              documents.map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => onSelectDoc(doc.id)}
                  className={`group flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer border transition-all ${
                    activeDocId === doc.id
                      ? 'bg-[rgba(12,22,25,0.9)] border-[rgba(33,212,229,0.45)] text-[#f2f7f7] shadow-[0_0_14px_rgba(33,212,229,0.1)]'
                      : 'border-transparent text-[#91a4a7] hover:bg-[#0b1115] hover:text-[#f2f7f7] hover:border-[rgba(100,220,205,0.12)]'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 truncate">
                    {doc.doc_type === 'code' ? (
                      <Code className="w-3.5 h-3.5 text-[#21d4e5] shrink-0" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-[#10bfa5] shrink-0" />
                    )}
                    <span className="truncate font-medium">{doc.title}</span>
                    {doc.is_protected && (
                      <span title="Threshold Protected (Consensus Required)">
                        <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                      </span>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete document "${doc.title}"?`)) onDeleteDoc(doc.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 text-[#91a4a7] transition-all"
                    title="Delete"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 2: SOURCE LIBRARY */}
      {activeTab === 'sources' && (
        <div className="flex-1 flex flex-col p-3 overflow-hidden">
          <div className="flex items-center justify-between mb-2.5 px-0.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#91a4a7] font-semibold">
              Source Library ({sources.length})
            </span>
            <button
              onClick={() => setShowAddSource(true)}
              className="p-1 rounded-lg bg-[#0b1115] hover:bg-[#121c21] border border-[rgba(100,220,205,0.2)] text-[#21d4e5] hover:border-[#21d4e5]/50 transition-all shadow-sm"
              title="Add Source"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mb-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#91a4a7] absolute left-2.5 top-2.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Search sources..."
                value={sourceSearch}
                onChange={(e) => setSourceSearch(e.target.value)}
                className="w-full bg-[#070d10] border border-[rgba(100,220,205,0.14)] rounded-lg pl-8 pr-2.5 py-1.5 text-xs text-[#f2f7f7] placeholder-[#91a4a7]/60 focus:outline-none focus:border-[#21d4e5]/50"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
            {sources
              .filter((s) => s.title.toLowerCase().includes(sourceSearch.toLowerCase()))
              .map((source) => {
                const sType = (source.source_type || '').toLowerCase();
                const sFile = source.filename || source.title || '';
                const isPdf = sType === 'pdf' || sFile.endsWith('.pdf');
                const isDocx = sType === 'docx' || sFile.endsWith('.docx');
                const isUrl = sType === 'url';
                const sizeStr = source.file_size
                  ? source.file_size < 1024 * 1024
                    ? `${(source.file_size / 1024).toFixed(0)} KB`
                    : `${(source.file_size / (1024 * 1024)).toFixed(1)} MB`
                  : null;

                return (
                  <div
                    key={source.id}
                    onClick={() => {
                      if (onOpenSourcePreview) {
                        onOpenSourcePreview(source);
                      }
                    }}
                    className="group p-2.5 rounded-xl bg-[rgba(12,22,25,0.7)] border border-[rgba(100,220,205,0.14)] hover:border-[#21d4e5]/40 hover:bg-[#0b1115] cursor-pointer transition-all shadow-sm"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center space-x-2 truncate">
                        {isUrl ? (
                          <Globe className="w-3.5 h-3.5 text-[#21d4e5] shrink-0" />
                        ) : isPdf ? (
                          <BookOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        ) : isDocx ? (
                          <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                        ) : (
                          <FileCode className="w-3.5 h-3.5 text-[#10bfa5] shrink-0" />
                        )}
                        <span className="text-xs font-semibold text-[#f2f7f7] truncate">{source.title}</span>
                      </div>
                      <div className="flex items-center space-x-1 shrink-0 ml-1">
                        {!isUrl && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              api.downloadSourceFile(roomCode, source.id, source.filename || source.title);
                            }}
                            className="p-1 text-[#91a4a7] hover:text-[#21d4e5] transition-colors"
                            title="Download original file"
                          >
                            <Download className="w-3 h-3" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteSource(source.id);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 text-[#91a4a7] transition-all"
                          title="Delete source"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center space-x-1.5 mt-1.5">
                      <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-[#10bfa5]/12 text-[#10bfa5] border border-[#10bfa5]/25">
                        {sType}
                      </span>
                      {sizeStr && (
                        <span className="text-[10px] font-mono text-[#91a4a7]">
                          {sizeStr}
                        </span>
                      )}
                    </div>

                    <p className="text-[11px] text-[#91a4a7] mt-1.5 line-clamp-2 leading-relaxed">
                      {source.content_preview || 'No preview available'}
                    </p>

                    {/* Accessible Action Buttons */}
                    <div className="mt-2 pt-2 border-t border-[rgba(100,220,205,0.1)] flex items-center justify-between">
                      {isPdf ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenSourcePreview?.(source);
                          }}
                          className="px-2 py-0.5 rounded-md bg-amber-950/40 border border-amber-800/50 text-amber-300 text-[10px] font-mono hover:bg-amber-900/50 flex items-center space-x-1 transition-all"
                        >
                          <BookOpen className="w-2.5 h-2.5" />
                          <span>Open PDF</span>
                        </button>
                      ) : isDocx ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenSourcePreview?.(source);
                          }}
                          className="px-2 py-0.5 rounded-md bg-blue-950/40 border border-blue-800/50 text-blue-300 text-[10px] font-mono hover:bg-blue-900/50 flex items-center space-x-1 transition-all"
                        >
                          <FileText className="w-2.5 h-2.5" />
                          <span>Preview Word</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onOpenSourcePreview?.(source);
                          }}
                          className="px-2 py-0.5 rounded-md bg-[#0b1115] border border-[rgba(100,220,205,0.2)] text-[#f2f7f7] hover:text-[#21d4e5] text-[10px] font-mono hover:bg-[#121c21] flex items-center space-x-1 transition-all"
                        >
                          <Eye className="w-2.5 h-2.5" />
                          <span>Preview</span>
                        </button>
                      )}

                      {!isUrl && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            api.downloadSourceFile(roomCode, source.id, source.filename || source.title);
                          }}
                          className="text-[10px] font-mono text-[#21d4e5] hover:text-white flex items-center space-x-1"
                        >
                          <Download className="w-2.5 h-2.5" />
                          <span>Download</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* TAB 3: KEY LOCKER */}
      {activeTab === 'vault' && (
        <div className="flex-1 flex flex-col p-3 overflow-hidden">
          <div className="flex items-center justify-between mb-2.5 px-0.5">
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#91a4a7] font-semibold">
              Secrets Locker ({secrets.length})
            </span>
            <button
              onClick={() => setShowAddSecret(true)}
              className="p-1 rounded-lg bg-[#0b1115] hover:bg-[#121c21] border border-[rgba(100,220,205,0.2)] text-[#21d4e5] hover:border-[#21d4e5]/50 transition-all shadow-sm"
              title="Add Secret"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
            {secrets.length === 0 ? (
              <div className="text-center py-12 px-4 rounded-xl border border-dashed border-[rgba(100,220,205,0.14)] bg-[#070d10]/40 text-xs text-[#91a4a7]">
                <Key className="w-6 h-6 mx-auto mb-2 text-[#91a4a7]/60" />
                Key locker is empty.<br />Safely store encrypted API credentials and private configs.
              </div>
            ) : (
              secrets.map((sec) => {
                const isRevealed = Boolean(revealedSecrets[sec.id]);
                const secretValue = revealedSecrets[sec.id] || sec.masked_preview;
                return (
                  <div key={sec.id} className="p-2.5 rounded-xl bg-[rgba(12,22,25,0.7)] border border-[rgba(100,220,205,0.14)] shadow-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[#f2f7f7] truncate">{sec.name}</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#10bfa5]/12 text-[#10bfa5] border border-[#10bfa5]/25 uppercase font-medium">
                        {sec.category}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between bg-[#070d10] px-2.5 py-1.5 rounded-lg border border-[rgba(100,220,205,0.12)]">
                      <span className="font-mono text-xs text-[#21d4e5] tracking-wider truncate">
                        {secretValue}
                      </span>
                      <div className="flex items-center space-x-1.5 shrink-0 ml-2">
                        <button
                          onClick={() => toggleReveal(sec.id)}
                          className="p-1 hover:text-[#21d4e5] text-[#91a4a7] transition-colors"
                          title={isRevealed ? 'Mask value' : 'Decrypt & Reveal'}
                        >
                          {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        {isRevealed && (
                          <button
                            onClick={() => copySecret(sec.id, secretValue)}
                            className="p-1 hover:text-[#10bfa5] text-[#91a4a7] transition-colors"
                            title="Copy plaintext to clipboard"
                          >
                            {copiedKey === sec.id ? <Check className="w-3.5 h-3.5 text-[#10bfa5]" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-[#91a4a7]">
                      <span className="truncate">{sec.description || 'Zero-knowledge stored'}</span>
                      <button
                        onClick={() => onDeleteSecret(sec.id)}
                        className="hover:text-red-400 p-0.5 text-[#91a4a7] transition-colors ml-2 shrink-0"
                        title="Delete Secret"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* CREATE DOCUMENT MODAL */}
      {showNewDocModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#0b1115] border border-[rgba(100,220,205,0.2)] rounded-2xl max-w-sm w-full p-5 shadow-2xl animate-fadeIn">
            <h3 className="text-sm font-bold text-[#f2f7f7] mb-3.5 font-mono flex items-center space-x-2">
              <FileText className="w-4 h-4 text-[#21d4e5]" />
              <span>Create Encrypted File</span>
            </h3>
            <form onSubmit={handleCreateDocSubmit} className="space-y-3.5">
              <div>
                <label className="text-[11px] font-mono text-[#91a4a7] block mb-1">File Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. system_architecture.md"
                  value={newDocTitle}
                  onChange={(e) => setNewDocTitle(e.target.value)}
                  className="w-full bg-[#070d10] border border-[rgba(100,220,205,0.16)] rounded-lg px-3 py-2 text-xs text-[#f2f7f7] focus:outline-none focus:border-[#21d4e5]"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono text-[#91a4a7] block mb-1">Document Format</label>
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => setNewDocType('document')}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-mono border transition-all ${
                      newDocType === 'document'
                        ? 'border-[#21d4e5] bg-[#21d4e5]/15 text-[#21d4e5] font-semibold'
                        : 'border-[rgba(100,220,205,0.14)] text-[#91a4a7] bg-[#070d10]'
                    }`}
                  >
                    Markdown Doc
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewDocType('code')}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-mono border transition-all ${
                      newDocType === 'code'
                        ? 'border-[#21d4e5] bg-[#21d4e5]/15 text-[#21d4e5] font-semibold'
                        : 'border-[rgba(100,220,205,0.14)] text-[#91a4a7] bg-[#070d10]'
                    }`}
                  >
                    Code File
                  </button>
                </div>
              </div>

              {newDocType === 'code' && (
                <div>
                  <label className="text-[11px] font-mono text-[#91a4a7] block mb-1">Language</label>
                  <select
                    value={newDocLang}
                    onChange={(e) => setNewDocLang(e.target.value)}
                    className="w-full bg-[#070d10] border border-[rgba(100,220,205,0.16)] rounded-lg px-3 py-2 text-xs text-[#f2f7f7] focus:outline-none focus:border-[#21d4e5]"
                  >
                    <option value="typescript">TypeScript</option>
                    <option value="python">Python</option>
                    <option value="json">JSON</option>
                    <option value="sql">SQL</option>
                    <option value="rust">Rust</option>
                  </select>
                </div>
              )}

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewDocModal(false)}
                  className="px-3 py-1.5 rounded-lg border border-[rgba(100,220,205,0.16)] text-xs text-[#91a4a7] hover:text-[#f2f7f7] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-[#21d4e5] to-[#10bfa5] text-xs text-[#05090b] font-bold shadow-md hover:opacity-90 transition-all"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ADD SOURCE MODAL */}
      {showAddSource && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#0b1115] border border-[rgba(100,220,205,0.2)] rounded-2xl max-w-sm w-full p-5 shadow-2xl animate-fadeIn">
            <h3 className="text-sm font-bold text-[#f2f7f7] mb-3.5 font-mono flex items-center space-x-2">
              <BookOpen className="w-4 h-4 text-[#21d4e5]" />
              <span>Add Reference Source</span>
            </h3>
            
            <div className="flex space-x-2 mb-3">
              <button
                type="button"
                onClick={() => setSourceType('url')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-mono border transition-all ${
                  sourceType === 'url' ? 'border-[#21d4e5] bg-[#21d4e5]/15 text-[#21d4e5] font-semibold' : 'border-[rgba(100,220,205,0.14)] text-[#91a4a7] bg-[#070d10]'
                }`}
              >
                Web URL
              </button>
              <button
                type="button"
                onClick={() => setSourceType('text')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-mono border transition-all ${
                  sourceType === 'text' ? 'border-[#21d4e5] bg-[#21d4e5]/15 text-[#21d4e5] font-semibold' : 'border-[rgba(100,220,205,0.14)] text-[#91a4a7] bg-[#070d10]'
                }`}
              >
                Pasted Text
              </button>
              <button
                type="button"
                onClick={() => setSourceType('file')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-mono border transition-all ${
                  sourceType === 'file' ? 'border-[#21d4e5] bg-[#21d4e5]/15 text-[#21d4e5] font-semibold' : 'border-[rgba(100,220,205,0.14)] text-[#91a4a7] bg-[#070d10]'
                }`}
              >
                Upload File
              </button>
            </div>

            {sourceType === 'file' ? (
              <div className="space-y-3">
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,.md,.json,.csv"
                  disabled={uploadingSource}
                  onChange={(e) => {
                    if (uploadingSource) return;
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) {
                      onUploadSource(file);
                      setShowAddSource(false);
                    }
                  }}
                  className="w-full text-xs text-[#f2f7f7] file:mr-2.5 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-bold file:bg-[#21d4e5] file:text-[#05090b] hover:file:opacity-90 cursor-pointer disabled:opacity-50"
                />
                <p className="text-[10px] text-[#91a4a7]">Supports PDF, Word (.docx), TXT, Markdown, JSON, CSV up to 10MB.</p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowAddSource(false)}
                    className="px-3 py-1.5 rounded-lg border border-[rgba(100,220,205,0.16)] text-xs text-[#91a4a7] hover:text-[#f2f7f7]"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleAddSourceSubmit} className="space-y-3">
                <div>
                  <label className="text-[11px] font-mono text-[#91a4a7] block mb-1">Title</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. API Security Architecture"
                    value={sourceTitle}
                    onChange={(e) => setSourceTitle(e.target.value)}
                    className="w-full bg-[#070d10] border border-[rgba(100,220,205,0.16)] rounded-lg px-3 py-2 text-xs text-[#f2f7f7] focus:outline-none focus:border-[#21d4e5]"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-mono text-[#91a4a7] block mb-1">
                    {sourceType === 'url' ? 'URL' : 'Notes / Content'}
                  </label>
                  {sourceType === 'url' ? (
                    <input
                      type="url"
                      required
                      placeholder="https://example.com/spec"
                      value={sourceInput}
                      onChange={(e) => setSourceInput(e.target.value)}
                      className="w-full bg-[#070d10] border border-[rgba(100,220,205,0.16)] rounded-lg px-3 py-2 text-xs text-[#f2f7f7] focus:outline-none focus:border-[#21d4e5]"
                    />
                  ) : (
                    <textarea
                      rows={4}
                      required
                      placeholder="Paste research notes, keys, or architectural background..."
                      value={sourceInput}
                      onChange={(e) => setSourceInput(e.target.value)}
                      className="w-full bg-[#070d10] border border-[rgba(100,220,205,0.16)] rounded-lg px-3 py-2 text-xs text-[#f2f7f7] focus:outline-none focus:border-[#21d4e5]"
                    />
                  )}
                </div>
                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddSource(false)}
                    className="px-3 py-1.5 rounded-lg border border-[rgba(100,220,205,0.16)] text-xs text-[#91a4a7] hover:text-[#f2f7f7]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-[#21d4e5] to-[#10bfa5] text-xs text-[#05090b] font-bold hover:opacity-90"
                  >
                    Add Source
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ADD SECRET MODAL */}
      {showAddSecret && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#0b1115] border border-[rgba(100,220,205,0.2)] rounded-2xl max-w-sm w-full p-5 shadow-2xl animate-fadeIn">
            <h3 className="text-sm font-bold text-[#f2f7f7] mb-3.5 font-mono flex items-center space-x-2">
              <Key className="w-4 h-4 text-[#21d4e5]" />
              <span>Store Secret in Locker</span>
            </h3>
            <form onSubmit={handleAddSecretSubmit} className="space-y-3">
              <div>
                <label className="text-[11px] font-mono text-[#91a4a7] block mb-1">Secret Identifier</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. AWS_SECRET_ACCESS_KEY"
                  value={secretName}
                  onChange={(e) => setSecretName(e.target.value)}
                  className="w-full bg-[#070d10] border border-[rgba(100,220,205,0.16)] rounded-lg px-3 py-2 text-xs text-[#f2f7f7] focus:outline-none focus:border-[#21d4e5]"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono text-[#91a4a7] block mb-1">Category</label>
                <select
                  value={secretCat}
                  onChange={(e) => setSecretCat(e.target.value)}
                  className="w-full bg-[#070d10] border border-[rgba(100,220,205,0.16)] rounded-lg px-3 py-2 text-xs text-[#f2f7f7] focus:outline-none focus:border-[#21d4e5]"
                >
                  <option value="api_key">API Key</option>
                  <option value="database">Database Password</option>
                  <option value="token">Access Token</option>
                  <option value="password">Password</option>
                  <option value="config">Private Config</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-mono text-[#91a4a7] block mb-1">Value (Encrypted Client-Side)</label>
                <input
                  type="password"
                  required
                  placeholder="Secret plaintext value..."
                  value={secretVal}
                  onChange={(e) => setSecretVal(e.target.value)}
                  className="w-full bg-[#070d10] border border-[rgba(100,220,205,0.16)] rounded-lg px-3 py-2 text-xs text-[#f2f7f7] focus:outline-none focus:border-[#21d4e5]"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono text-[#91a4a7] block mb-1">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="Production deployment credentials"
                  value={secretDesc}
                  onChange={(e) => setSecretDesc(e.target.value)}
                  className="w-full bg-[#070d10] border border-[rgba(100,220,205,0.16)] rounded-lg px-3 py-2 text-xs text-[#f2f7f7] focus:outline-none focus:border-[#21d4e5]"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddSecret(false)}
                  className="px-3 py-1.5 rounded-lg border border-[rgba(100,220,205,0.16)] text-xs text-[#91a4a7] hover:text-[#f2f7f7]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-[#21d4e5] to-[#10bfa5] text-xs text-[#05090b] font-bold hover:opacity-90"
                >
                  Encrypt & Save
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
};
