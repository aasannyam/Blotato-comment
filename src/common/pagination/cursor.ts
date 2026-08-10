import { InvalidCursorException } from '../errors/domain.exception';

/**
 * Keyset pagination, not offset. Comment lists are append-heavy and mutate under
 * the reader: OFFSET degrades on deep pages and silently skips or repeats rows
 * when new comments land mid-scroll.
 *
 * Opaque base64 so the contents stay ours to change. Not signed — it carries no
 * authorisation, and every query is re-scoped to the caller's workspace anyway.
 */
export interface CursorPayload {
  /** Sort key of the last row: a timestamp, or a path for thread ordering. */
  k: string;
  /** Tie-breaker for rows sharing a sort key. */
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorPayload;
    if (!parsed?.k || !parsed?.id) throw new Error('malformed cursor');
    return { k: parsed.k, id: parsed.id };
  } catch {
    throw new InvalidCursorException();
  }
}

export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

/** Callers fetch `limit + 1`; the extra row becomes the cursor, so no COUNT is needed. */
export function buildPage<T>(
  rows: T[],
  limit: number,
  toCursor: (row: T) => CursorPayload,
): Page<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data[data.length - 1];
  return { data, nextCursor: hasMore && last ? encodeCursor(toCursor(last)) : null };
}
