export interface ExportableDoc {
  id: string;
  title?: string;
  doc_type?: string;
  language?: string;
}

export interface ExportResponse {
  export_id: string;
  watermark: string;
  format?: string;
  exported_at?: string;
}

function renderInlineMarks(node: any): string {
  if (!node) return '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type !== 'text') {
    return Array.isArray(node.content) ? node.content.map(renderInlineMarks).join('') : '';
  }

  let text = node.text || '';
  const marks = Array.isArray(node.marks) ? node.marks : [];
  for (const mark of marks) {
    if (mark.type === 'code') text = `\`${text}\``;
    else if (mark.type === 'bold') text = `**${text}**`;
    else if (mark.type === 'italic') text = `*${text}*`;
    else if (mark.type === 'strike') text = `~~${text}~~`;
  }
  return text;
}

function renderBlock(node: any, listPrefix = ''): string {
  if (!node) return '';
  const children = Array.isArray(node.content) ? node.content : [];

  switch (node.type) {
    case 'doc':
      return children.map((child: any) => renderBlock(child)).filter(Boolean).join('\n\n');
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs?.level || 1)));
      const text = children.map(renderInlineMarks).join('');
      return `${'#'.repeat(level)} ${text}`.trimEnd();
    }
    case 'paragraph': {
      const text = children.map(renderInlineMarks).join('');
      return `${listPrefix}${text}`;
    }
    case 'bulletList':
      return children
        .map((item: any) => {
          const itemBlocks = Array.isArray(item.content) ? item.content : [];
          return itemBlocks.map((b: any, idx: number) => renderBlock(b, idx === 0 ? '- ' : '  ')).join('\n');
        })
        .join('\n');
    case 'orderedList': {
      const start = Number(node.attrs?.start || 1);
      return children
        .map((item: any, index: number) => {
          const itemBlocks = Array.isArray(item.content) ? item.content : [];
          const prefix = `${start + index}. `;
          return itemBlocks.map((b: any, idx: number) => renderBlock(b, idx === 0 ? prefix : '   ')).join('\n');
        })
        .join('\n');
    }
    case 'blockquote': {
      const inner = children.map((child: any) => renderBlock(child)).join('\n');
      return inner
        .split('\n')
        .map((line: string) => `> ${line}`)
        .join('\n');
    }
    case 'codeBlock': {
      const lang = node.attrs?.language || '';
      const code = children.map((n: any) => n.text || '').join('');
      return `\`\`\`${lang}\n${code}\n\`\`\``;
    }
    case 'horizontalRule':
      return '---';
    default:
      return children.map((child: any) => renderInlineMarks(child)).join('');
  }
}

export function tiptapJsonToMarkdown(jsonDoc: any): string {
  if (!jsonDoc) return '';
  return renderBlock(jsonDoc);
}

export function extractDocumentContent(options: {
  doc: ExportableDoc;
  format: string;
  plaintext: string;
  collabCodeText?: string;
  editorJson?: any;
  editorText?: string;
}): string {
  const { doc, format, plaintext, collabCodeText, editorJson, editorText } = options;
  if (doc.doc_type === 'code') {
    return collabCodeText !== undefined ? collabCodeText : plaintext;
  }
  if (format === 'markdown' && editorJson) {
    const md = tiptapJsonToMarkdown(editorJson);
    if (md.trim().length > 0) return md;
  }
  if (editorText !== undefined && editorText !== null) {
    return editorText;
  }
  return plaintext;
}

export function sanitizeFilenameSegment(title: string | undefined): string {
  const base = (title || 'document')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_');
  const trimmed = base.replace(/^_+|_+$/g, '');
  return trimmed || 'document';
}

export function buildExportArtifact(options: {
  doc: ExportableDoc;
  content: string;
  exportMeta: ExportResponse;
  format?: string;
}): {
  content: string;
  filename: string;
  mimeType: string;
} {
  const { doc, content, exportMeta, format = 'markdown' } = options;
  const isCode = doc.doc_type === 'code';
  const useMarkdown = !isCode && format === 'markdown';

  const header = useMarkdown
    ? `<!-- ${exportMeta.watermark} -->`
    : `/* ${exportMeta.watermark} */`;

  const watermarkedContent = `${header}\n\n${content}`;
  const ext = useMarkdown ? 'md' : 'txt';
  const mimeType = useMarkdown ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8';
  const filename = `${sanitizeFilenameSegment(doc.title)}_${exportMeta.export_id}.${ext}`;

  return {
    content: watermarkedContent,
    filename,
    mimeType,
  };
}

export function triggerBlobDownload(
  content: string,
  filename: string,
  mimeType: string,
  dom: {
    document: Document;
    URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
    setTimeoutFn?: (fn: () => void, ms: number) => any;
  } = {
    document: window.document,
    URL: window.URL,
    setTimeoutFn: window.setTimeout.bind(window),
  }
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = dom.URL.createObjectURL(blob);
  const a = dom.document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  dom.document.body.appendChild(a);
  try {
    a.click();
  } finally {
    if (a.parentNode) {
      a.parentNode.removeChild(a);
    }
    const schedule = dom.setTimeoutFn || setTimeout;
    schedule(() => {
      dom.URL.revokeObjectURL(url);
    }, 1500);
  }
}
