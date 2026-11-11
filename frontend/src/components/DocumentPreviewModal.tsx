import React, { useState, useEffect } from 'react';
import {
  X,
  Download,
  ExternalLink,
  FileText,
  BookOpen,
  FileCode,
  AlertTriangle,
  Lock,
  Loader2,
  FileSpreadsheet,
  File
} from 'lucide-react';
import { api } from '../lib/api';
import { decryptEnvelope } from '../lib/crypto';

interface DocumentPreviewModalProps {
  isOpen: boolean;
  source: any | null;
  roomCode: string;
  roomKey: CryptoKey | null;
  onClose: () => void;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  isOpen,
  source,
  roomCode,
  roomKey,
  onClose,
}) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docxParagraphs, setDocxParagraphs] = useState<string[]>([]);
  const [textContent, setTextContent] = useState<string>('');
  const [isEncrypted, setIsEncrypted] = useState(false);

  // Clean up object URL when source changes or modal unmounts to prevent memory leaks
  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  useEffect(() => {
    if (!isOpen || !source) {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        setBlobUrl(null);
      }
      setDocxParagraphs([]);
      setTextContent('');
      setError(null);
      return;
    }

    let isSubscribed = true;
    const loadContent = async () => {
      setLoading(true);
      setError(null);

      try {
        const type = (source.source_type || '').toLowerCase();
        const filename = source.filename || source.title || '';
        const ext = '.' + filename.split('.').pop()?.toLowerCase();

        // Check if content is client-side encrypted envelope
        const rawContent = source.extracted_text_encrypted || '';
        let decryptedText: string | null = null;

        if (rawContent && rawContent.startsWith('{') && rawContent.includes('"ciphertext"')) {
          setIsEncrypted(true);
          if (roomKey) {
            try {
              const envelope = JSON.parse(rawContent);
              decryptedText = await decryptEnvelope(envelope, roomKey);
            } catch {
              decryptedText = null;
            }
          }
        } else {
          setIsEncrypted(false);
        }

        // 1. PDF File handling
        if (type === 'pdf' || ext === '.pdf') {
          // Fetch raw PDF blob from authenticated server endpoint
          const blob = await api.getSourceFileBlob(roomCode, source.id, false);
          if (!isSubscribed) return;
          const url = URL.createObjectURL(blob);
          setBlobUrl(url);
        }
        // 2. Word Document (.docx) handling
        else if (type === 'docx' || ext === '.docx') {
          // If we have text from server extraction or client decryption:
          const text = decryptedText || source.extracted_text_encrypted || source.content_preview || '';
          if (text) {
            const paragraphs = text
              .split(/\n\s*\n|\r\n\s*\r\n/)
              .map((p: string) => p.trim())
              .filter(Boolean);
            setDocxParagraphs(paragraphs);
          } else {
            setDocxParagraphs(['Document content is empty or could not be parsed.']);
          }
        }
        // 3. Text / Markdown / JSON / CSV handling
        else if (['markdown', 'text', 'json', 'csv', 'md', 'txt'].includes(type) || ['.md', '.txt', '.json', '.csv'].includes(ext)) {
          setTextContent(decryptedText || source.extracted_text_encrypted || source.content_preview || '');
        }
        // 4. Fallback: try reading text preview
        else {
          setTextContent(source.content_preview || 'No preview available for this file type.');
        }
      } catch (err: any) {
        if (isSubscribed) {
          setError(err.message || 'Failed to load document preview');
        }
      } finally {
        if (isSubscribed) {
          setLoading(false);
        }
      }
    };

    loadContent();

    return () => {
      isSubscribed = false;
    };
  }, [isOpen, source, roomCode, roomKey]);

  if (!isOpen || !source) return null;

  const filename = source.filename || source.title || 'Document';
  const type = (source.source_type || '').toLowerCase();
  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  const isPdf = type === 'pdf' || ext === '.pdf';
  const isDocx = type === 'docx' || ext === '.docx';
  const isCodeOrData = ['json', 'csv'].includes(type) || ['.json', '.csv'].includes(ext);
  const isMarkdown = type === 'markdown' || ext === '.md';

  const formatFileSize = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const handleDownload = () => {
    api.downloadSourceFile(roomCode, source.id, filename);
  };

  const handleOpenInNewTab = () => {
    if (blobUrl) {
      window.open(blobUrl, '_blank');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center z-50 p-4 select-none animate-fadeIn">
      <div className="bg-[#0B1115]/95 border border-[rgba(100,220,205,0.18)] rounded-2xl max-w-4xl w-full flex flex-col h-[85vh] shadow-[0_12px_50px_rgba(0,0,0,0.85)] overflow-hidden backdrop-blur-xl relative">
        {/* Top subtle glow line */}
        <div className="bg-gradient-to-r from-[#10BFA5]/40 via-[#21D4E5]/30 to-transparent h-[1px] absolute top-0 left-0 right-0" />

        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(100,220,205,0.12)] bg-[#070D10] shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-[#0F1D24] border border-[#21D4E5]/30 flex items-center justify-center shrink-0 text-[#21D4E5] shadow-[0_0_12px_rgba(33,212,229,0.2)]">
              {isPdf ? (
                <BookOpen className="w-4 h-4 text-amber-400" />
              ) : isDocx ? (
                <FileText className="w-4 h-4 text-[#21D4E5]" />
              ) : isCodeOrData ? (
                <FileSpreadsheet className="w-4 h-4 text-[#10BFA5]" />
              ) : (
                <FileCode className="w-4 h-4 text-[#21D4E5]" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-xs font-mono font-bold text-slate-100 truncate flex items-center space-x-2">
                <span className="truncate">{filename}</span>
                {isEncrypted && (
                  <span className="shrink-0 flex items-center space-x-1 px-2 py-0.5 rounded-full text-[9px] font-mono bg-[#10BFA5]/15 text-[#10BFA5] border border-[#10BFA5]/40">
                    <Lock className="w-2.5 h-2.5" />
                    <span>E2EE</span>
                  </span>
                )}
              </h2>
              <div className="flex items-center space-x-2 text-[10px] font-mono text-slate-400 mt-0.5">
                <span className="uppercase text-[#21D4E5] font-semibold">{type || ext.slice(1)}</span>
                <span>•</span>
                <span>{formatFileSize(source.file_size)}</span>
                <span>•</span>
                <span>Room {roomCode}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center space-x-2.5 shrink-0">
            {isPdf && blobUrl && (
              <button
                type="button"
                onClick={handleOpenInNewTab}
                className="px-3 py-1.5 rounded-xl border border-[rgba(100,220,205,0.16)] bg-[#0F171B] hover:bg-[#152329] text-xs font-mono text-slate-300 hover:text-white flex items-center space-x-1.5 transition-colors"
                title="Open PDF in new browser window"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">New Tab</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleDownload}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-[#10BFA5] to-[#21D4E5] hover:opacity-90 text-slate-950 font-mono font-semibold text-xs flex items-center space-x-1.5 transition-all shadow-[0_0_15px_rgba(33,212,229,0.3)]"
              title="Download original document file"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download {isPdf ? 'PDF' : isDocx ? 'DOCX' : 'File'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Viewer Body */}
        <div className="flex-1 bg-[#05090B] overflow-hidden flex flex-col p-4">
          {loading && (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-[#21D4E5]" />
              <span className="text-xs font-mono">Loading document preview safely...</span>
            </div>
          )}

          {error && !loading && (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-red-950/40 border border-red-500/40 flex items-center justify-center text-red-400">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <p className="text-xs font-mono text-red-300 max-w-md">{error}</p>
              <button
                type="button"
                onClick={handleDownload}
                className="px-3.5 py-1.5 rounded-xl bg-[#0F171B] border border-[rgba(100,220,205,0.18)] text-xs font-mono text-[#21D4E5] hover:text-white"
              >
                Download original file instead
              </button>
            </div>
          )}

          {!loading && !error && (
            <>
              {/* PDF Viewer via Browser-Based Sandboxed iFrame / Object */}
              {isPdf && blobUrl && (
                <div className="w-full h-full flex flex-col">
                  <iframe
                    src={blobUrl}
                    title="PDF Viewer"
                    className="w-full flex-1 rounded-xl border border-[rgba(100,220,205,0.14)] bg-[#070D10]"
                  />
                  <div className="mt-2.5 flex items-center justify-between text-[11px] font-mono text-slate-400 px-1">
                    <span>Rendered via sandboxed client viewer. Zero cloud telemetry.</span>
                    <button
                      type="button"
                      onClick={handleDownload}
                      className="text-[#21D4E5] hover:underline"
                    >
                      Having trouble viewing? Download PDF
                    </button>
                  </div>
                </div>
              )}

              {/* Word Document (.docx) Client-Side Viewer */}
              {isDocx && (
                <div className="w-full h-full flex flex-col overflow-hidden">
                  <div className="mb-2.5 px-3.5 py-2.5 rounded-xl bg-[#070D10] border border-[rgba(100,220,205,0.14)] flex items-center justify-between text-[11px] font-mono text-slate-400">
                    <span className="flex items-center space-x-2 text-[#21D4E5]">
                      <FileText className="w-3.5 h-3.5" />
                      <span>Microsoft Word (.docx) — Safe Parsed Preview</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleDownload}
                      className="text-[#10BFA5] hover:text-white flex items-center space-x-1.5 transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      <span>Open in Word</span>
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto rounded-xl border border-[rgba(100,220,205,0.12)] bg-[#070D10] p-6 font-sans text-slate-200 space-y-4 leading-relaxed">
                    {docxParagraphs.length === 0 ? (
                      <p className="text-slate-500 text-xs font-mono">No readable paragraph content found in document.</p>
                    ) : (
                      docxParagraphs.map((para, idx) => (
                        <p
                          key={idx}
                          className="text-xs sm:text-sm text-slate-200 border-l-2 border-transparent hover:border-[#21D4E5]/50 pl-3 transition-colors whitespace-pre-wrap leading-relaxed"
                        >
                          {para}
                        </p>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* Text / Markdown / Code / JSON / CSV Viewer */}
              {!isPdf && !isDocx && (
                <div className="w-full h-full flex flex-col overflow-hidden">
                  <div className="flex-1 overflow-y-auto rounded-xl border border-[rgba(100,220,205,0.12)] bg-[#070D10] p-5 font-mono text-xs text-slate-300 leading-relaxed whitespace-pre-wrap">
                    {textContent || 'Document is empty.'}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
