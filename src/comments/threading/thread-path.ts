/**
 * Materialised-path helpers.
 *
 * A segment is `<zero-padded epoch ms>-<short id>`. Fixed-width time first means
 * lexicographic path order is also chronological thread order, so `ORDER BY path`
 * returns a conversation already in reading order — no recursive CTE, no
 * application-side tree assembly.
 */
const TIME_WIDTH = 14;
const SEPARATOR = '/';

export function childPath(parentPath: string | null, id: string, at: Date): string {
  const segment = `${at.getTime().toString().padStart(TIME_WIDTH, '0')}-${id.replace(/-/g, '').slice(0, 8)}`;
  return parentPath ? `${parentPath}${SEPARATOR}${segment}` : segment;
}

/** Matches every descendant of `path`, excluding the node itself. */
export function descendantPattern(path: string): string {
  return `${path}${SEPARATOR}%`;
}

/**
 * Ancestor path at `depth`, derived from a descendant's path alone — one
 * exact-match lookup instead of walking `parent_id` up the tree.
 */
export function ancestorPathAtDepth(path: string, depth: number): string {
  return path.split(SEPARATOR).slice(0, depth + 1).join(SEPARATOR);
}
