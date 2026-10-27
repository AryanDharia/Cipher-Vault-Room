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
  AlertCircle
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
  onDeleteSource: (sourceId: string) => void;
  secrets: any[];
  onAddSecret: (name: string, category: string, value: string, desc?: string) => void;
  onRevealSecret: (secretId: string) => Promise<string | null>;
  onDeleteSecret: (secretId: string) => void;
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
  onDeleteSource,
  secrets,
  onAddSecret,
  onRevealSecret,
  onDeleteSecret,
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
  const [selectedSourcePreview, setSelectedSourcePreview] = useState<any | null>(null);

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
    <aside className="w-72 border-r border-[#212638] bg-[#0d0f17] flex flex-col h-[calc(100vh-3.5rem)] select-none">
      {/* Tab Navigation */}
      <div className="flex border-b border-[#212638] bg-[#0c0e15]">
        <button
          onClick={() => setActiveTab('docs')}
          className={`flex-1 py-2.5 text-xs font-mono font-medium flex items-center justify-center space-x-1.5 transition-colors border-b-2 ${
            activeTab === 'docs'
              ? 'border-cyan-400 text-cyan-400 bg-[#141724]'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Files</span>
        </button>
        <button
          onClick={() => setActiveTab('sources')}
          className={`flex-1 py-2.5 text-xs font-mono font-medium flex items-center justify-center space-x-1.5 transition-colors border-b-2 ${
            activeTab === 'sources'
              ? 'border-cyan-400 text-cyan-400 bg-[#141724]'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Sources</span>
        </button>
        <button
          onClick={() => setActiveTab('vault')}
          className={`flex-1 py-2.5 text-xs font-mono font-medium flex items-center justify-center space-x-1.5 transition-colors border-b-2 ${
            activeTab === 'vault'
              ? 'border-cyan-400 text-cyan-400 bg-[#141724]'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Key className="w-3.5 h-3.5" />
          <span>Locker</span>
        </button>
      </div>

      {/* TAB 1: DOCUMENTS */}
      {activeTab === 'docs' && (
        <div className="flex-1 flex flex-col p-3 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">Workspace Files</span>
            <button
              onClick={() => setShowNewDocModal(true)}
              className="p-1 rounded bg-[#161a29] hover:bg-[#20253b] border border-[#262c42] text-cyan-400 transition-colors"
              title="Create Document"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1">
            {documents.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">
                No documents in vault. Create one to begin.
              </div>
            ) : (
              documents.map((doc) => (
                <div
                  key={doc.id}
                  onClick={() => onSelectDoc(doc.id)}
                  className={`group flex items-center justify-between px-2.5 py-2 rounded text-xs cursor-pointer border transition-all ${
                    activeDocId === doc.id
                      ? 'bg-[#181d2e] border-cyan-500/40 text-slate-100'
                      : 'border-transparent text-slate-400 hover:bg-[#131622] hover:text-slate-200'
                  }`}
                >
                  <div className="flex items-center space-x-2 truncate">
                    {doc.doc_type === 'code' ? (
                      <Code className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                    ) : (
                      <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    )}
                    <span className="truncate font-medium">{doc.title}</span>
                    {doc.is_protected && (
                      <span title="Threshold Protected (2-of-3)">
                        <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                      </span>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete document "${doc.title}"?`)) onDeleteDoc(doc.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity"
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

      {/* TAB 2: SOURCE LIBRARY (NotebookLM Inspired) */}
      {activeTab === 'sources' && (
        <div className="flex-1 flex flex-col p-3 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
              Source Library ({sources.length})
            </span>
            <button
              onClick={() => setShowAddSource(true)}
              className="p-1 rounded bg-[#161a29] hover:bg-[#20253b] border border-[#262c42] text-cyan-400 transition-colors"
              title="Add Source"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="mb-2">
            <div className="relative">
              <Search className="w-3 h-3 text-slate-500 absolute left-2 top-2.5" />
              <input
                type="text"
                placeholder="Search sources..."
                value={sourceSearch}
                onChange={(e) => setSourceSearch(e.target.value)}
                className="w-full bg-[#12141f] border border-[#212638] rounded pl-7 pr-2 py-1 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500/50"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5">
            {sources
              .filter((s) => s.title.toLowerCase().includes(sourceSearch.toLowerCase()))
              .map((source) => (
                <div
                  key={source.id}
                  onClick={() => setSelectedSourcePreview(source)}
                  className="group p-2 rounded bg-[#121522] border border-[#1f2438] hover:border-cyan-500/30 cursor-pointer transition-all"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 truncate">
                      {source.source_type === 'url' ? (
                        <Globe className="w-3 h-3 text-cyan-400 shrink-0" />
                      ) : source.source_type === 'pdf' ? (
                        <BookOpen className="w-3 h-3 text-amber-400 shrink-0" />
                      ) : (
                        <FileText className="w-3 h-3 text-slate-400 shrink-0" />
                      )}
                      <span className="text-xs font-medium text-slate-200 truncate">{source.title}</span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSource(source.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-opacity"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-tight">
                    {source.content_preview || 'No preview available'}
                  </p>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* TAB 3: KEY LOCKER */}
      {activeTab === 'vault' && (
        <div className="flex-1 flex flex-col p-3 overflow-hidden">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
              Secrets Vault ({secrets.length})
            </span>
            <button
              onClick={() => setShowAddSecret(true)}
              className="p-1 rounded bg-[#161a29] hover:bg-[#20253b] border border-[#262c42] text-cyan-400 transition-colors"
              title="Add Secret"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2">
            {secrets.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">
                Key locker is empty. Store API keys and credentials safely.
              </div>
            ) : (
              secrets.map((sec) => {
                const isRevealed = Boolean(revealedSecrets[sec.id]);
                const secretValue = revealedSecrets[sec.id] || sec.masked_preview;
                return (
                  <div key={sec.id} className="p-2.5 rounded bg-[#121522] border border-[#1f2438]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-200 truncate">{sec.name}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#191d2d] text-cyan-400 border border-cyan-800/30 uppercase">
                        {sec.category}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between bg-[#0a0c13] px-2 py-1.5 rounded border border-[#1b1f30]">
                      <span className="font-mono text-xs text-slate-300 tracking-wider truncate">
                        {secretValue}
                      </span>
                      <div className="flex items-center space-x-1 shrink-0 ml-2">
                        <button
                          onClick={() => toggleReveal(sec.id)}
                          className="p-1 hover:text-cyan-400 text-slate-400 transition-colors"
                          title={isRevealed ? 'Mask value' : 'Decrypt & Reveal'}
                        >
                          {isRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        {isRevealed && (
                          <button
                            onClick={() => copySecret(sec.id, secretValue)}
                            className="p-1 hover:text-emerald-400 text-slate-400 transition-colors"
                            title="Copy plaintext to clipboard"
                          >
                            {copiedKey === sec.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="mt-1 flex items-center justify-between text-[10px] text-slate-500">
                      <span>{sec.description || 'Zero-knowledge stored'}</span>
                      <button
                        onClick={() => onDeleteSecret(sec.id)}
                        className="hover:text-red-400 p-0.5"
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
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#121522] border border-[#262c42] rounded-lg max-w-sm w-full p-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-slate-100 mb-3 font-mono">Create New File</h3>
            <form onSubmit={handleCreateDocSubmit} className="space-y-3">
              <div>
                <label className="text-[11px] font-mono text-slate-400 block mb-1">File Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. system_architecture.md"
                  value={newDocTitle}
                  onChange={(e) => setNewDocTitle(e.target.value)}
                  className="w-full bg-[#0a0c13] border border-[#212638] rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/50"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono text-slate-400 block mb-1">Type</label>
                <div className="flex space-x-2">
                  <button
                    type="button"
                    onClick={() => setNewDocType('document')}
                    className={`flex-1 py-1.5 rounded text-xs font-mono border ${
                      newDocType === 'document'
                        ? 'border-cyan-500 bg-cyan-950/40 text-cyan-300'
                        : 'border-[#212638] text-slate-400 bg-[#0a0c13]'
                    }`}
                  >
                    Markdown Doc
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewDocType('code')}
                    className={`flex-1 py-1.5 rounded text-xs font-mono border ${
                      newDocType === 'code'
                        ? 'border-cyan-500 bg-cyan-950/40 text-cyan-300'
                        : 'border-[#212638] text-slate-400 bg-[#0a0c13]'
                    }`}
                  >
                    Code File
                  </button>
                </div>
              </div>

              {newDocType === 'code' && (
                <div>
                  <label className="text-[11px] font-mono text-slate-400 block mb-1">Language</label>
                  <select
                    value={newDocLang}
                    onChange={(e) => setNewDocLang(e.target.value)}
                    className="w-full bg-[#0a0c13] border border-[#212638] rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/50"
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
                  className="px-3 py-1.5 rounded border border-[#212638] text-xs text-slate-400 hover:text-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-xs text-slate-900 font-semibold"
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
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#121522] border border-[#262c42] rounded-lg max-w-sm w-full p-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-slate-100 mb-3 font-mono">Add Reference Source</h3>
            
            <div className="flex space-x-2 mb-3">
              <button
                type="button"
                onClick={() => setSourceType('url')}
                className={`flex-1 py-1 rounded text-xs font-mono border ${
                  sourceType === 'url' ? 'border-cyan-500 bg-cyan-950/40 text-cyan-300' : 'border-[#212638] text-slate-400'
                }`}
              >
                Web URL
              </button>
              <button
                type="button"
                onClick={() => setSourceType('text')}
                className={`flex-1 py-1 rounded text-xs font-mono border ${
                  sourceType === 'text' ? 'border-cyan-500 bg-cyan-950/40 text-cyan-300' : 'border-[#212638] text-slate-400'
                }`}
              >
                Pasted Text
              </button>
              <button
                type="button"
                onClick={() => setSourceType('file')}
                className={`flex-1 py-1 rounded text-xs font-mono border ${
                  sourceType === 'file' ? 'border-cyan-500 bg-cyan-950/40 text-cyan-300' : 'border-[#212638] text-slate-400'
                }`}
              >
                Upload File
              </button>
            </div>

            {sourceType === 'file' ? (
              <div className="space-y-3">
                <input
                  type="file"
                  accept=".pdf,.txt,.md,.json,.csv"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      onUploadSource(file);
                      setShowAddSource(false);
                    }
                  }}
                  className="w-full text-xs text-slate-300 file:mr-2 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-cyan-600 file:text-slate-900 hover:file:bg-cyan-500"
                />
                <p className="text-[10px] text-slate-500">Supports PDF, TXT, MD, JSON up to 10MB.</p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShowAddSource(false)}
                    className="px-3 py-1 rounded border border-[#212638] text-xs text-slate-400"
                  >
                    Close
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleAddSourceSubmit} className="space-y-3">
                <div>
                  <label className="text-[11px] font-mono text-slate-400 block mb-1">Title</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Stripe API Specs"
                    value={sourceTitle}
                    onChange={(e) => setSourceTitle(e.target.value)}
                    className="w-full bg-[#0a0c13] border border-[#212638] rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/50"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-mono text-slate-400 block mb-1">
                    {sourceType === 'url' ? 'URL' : 'Notes / Content'}
                  </label>
                  {sourceType === 'url' ? (
                    <input
                      type="url"
                      required
                      placeholder="https://docs.stripe.com/api"
                      value={sourceInput}
                      onChange={(e) => setSourceInput(e.target.value)}
                      className="w-full bg-[#0a0c13] border border-[#212638] rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/50"
                    />
                  ) : (
                    <textarea
                      rows={4}
                      required
                      placeholder="Paste research notes, keys, or architectural background..."
                      value={sourceInput}
                      onChange={(e) => setSourceInput(e.target.value)}
                      className="w-full bg-[#0a0c13] border border-[#212638] rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/50"
                    />
                  )}
                </div>
                <div className="flex justify-end space-x-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddSource(false)}
                    className="px-3 py-1.5 rounded border border-[#212638] text-xs text-slate-400"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-xs text-slate-900 font-semibold"
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
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-[#121522] border border-[#262c42] rounded-lg max-w-sm w-full p-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-slate-100 mb-3 font-mono">Store Secret in Key Locker</h3>
            <form onSubmit={handleAddSecretSubmit} className="space-y-3">
              <div>
                <label className="text-[11px] font-mono text-slate-400 block mb-1">Secret Identifier</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. AWS_SECRET_ACCESS_KEY"
                  value={secretName}
                  onChange={(e) => setSecretName(e.target.value)}
                  className="w-full bg-[#0a0c13] border border-[#212638] rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/50"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono text-slate-400 block mb-1">Category</label>
                <select
                  value={secretCat}
                  onChange={(e) => setSecretCat(e.target.value)}
                  className="w-full bg-[#0a0c13] border border-[#212638] rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/50"
                >
                  <option value="api_key">API Key</option>
                  <option value="database">Database Password</option>
                  <option value="token">Access Token</option>
                  <option value="password">Password</option>
                  <option value="config">Private Config</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-mono text-slate-400 block mb-1">Value (Encrypted Client-Side)</label>
                <input
                  type="password"
                  required
                  placeholder="Secret plaintext value..."
                  value={secretVal}
                  onChange={(e) => setSecretVal(e.target.value)}
                  className="w-full bg-[#0a0c13] border border-[#212638] rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/50"
                />
              </div>

              <div>
                <label className="text-[11px] font-mono text-slate-400 block mb-1">Description (Optional)</label>
                <input
                  type="text"
                  placeholder="Production deployment credentials"
                  value={secretDesc}
                  onChange={(e) => setSecretDesc(e.target.value)}
                  className="w-full bg-[#0a0c13] border border-[#212638] rounded px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-cyan-500/50"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddSecret(false)}
                  className="px-3 py-1.5 rounded border border-[#212638] text-xs text-slate-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-xs text-slate-900 font-semibold"
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
