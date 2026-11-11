export interface SourceListItem {
  id: string;
  title?: string;
  source_type?: string;
  filename?: string;
  file_size?: number;
  content_preview?: string;
  url?: string;
  tags?: string[];
  created_at?: string;
  [key: string]: any;
}

/**
 * Idempotently insert or update a source entry by its stable server-generated ID.
 * Preserves existing ordering when updating, or prepends new entries without duplication.
 * Never uses filename as a unique identifier.
 */
export function upsertSource<T extends SourceListItem>(
  prev: T[],
  incoming: T | null | undefined
): T[] {
  if (!incoming || !incoming.id) return prev;

  const existingIndex = prev.findIndex((item) => item && item.id === incoming.id);
  if (existingIndex === -1) {
    return [incoming, ...dedupeSources(prev)];
  }

  const next = dedupeSources(prev);
  const idx = next.findIndex((item) => item.id === incoming.id);
  if (idx !== -1) {
    next[idx] = { ...next[idx], ...incoming };
  }
  return next;
}

/**
 * Deduplicate an array of source entries strictly by server-generated ID,
 * preserving first-seen order while merging any newer fields.
 */
export function dedupeSources<T extends SourceListItem>(items: T[]): T[] {
  const seen = new Map<string, number>();
  const result: T[] = [];

  for (const item of items) {
    if (!item || !item.id) continue;
    const existingIdx = seen.get(item.id);
    if (existingIdx === undefined) {
      seen.set(item.id, result.length);
      result.push(item);
    } else {
      result[existingIdx] = { ...result[existingIdx], ...item };
    }
  }

  return result;
}

export function removeSourceById<T extends SourceListItem>(prev: T[], sourceId: string): T[] {
  if (!sourceId) return prev;
  return prev.filter((item) => item && item.id !== sourceId);
}
