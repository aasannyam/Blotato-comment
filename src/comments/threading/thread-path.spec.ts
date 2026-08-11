import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { InvalidCursorException } from '../../common/errors/domain.exception';
import { ancestorPathAtDepth, childPath, descendantPattern } from './thread-path';

describe('thread paths', () => {
  it('sorts siblings chronologically as plain strings', () => {
    const earlier = childPath(null, 'aaaaaaaa-0000-0000-0000-000000000000', new Date(1_000));
    const later = childPath(null, 'bbbbbbbb-0000-0000-0000-000000000000', new Date(2_000));

    // This is the whole point of the fixed-width time prefix: ORDER BY path is
    // also chronological order, so a thread comes back in reading order.
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it('nests a child under its parent so a prefix match selects the subtree', () => {
    const parent = childPath(null, 'aaaaaaaa-0000-0000-0000-000000000000', new Date(1_000));
    const child = childPath(parent, 'bbbbbbbb-0000-0000-0000-000000000000', new Date(2_000));

    expect(child.startsWith(`${parent}/`)).toBe(true);
    expect(descendantPattern(parent)).toBe(`${parent}/%`);
  });

  it('resolves an ancestor at a given depth from a descendant path alone', () => {
    expect(ancestorPathAtDepth('a/b/c', 0)).toBe('a');
    expect(ancestorPathAtDepth('a/b/c', 1)).toBe('a/b');
  });
});

describe('cursors', () => {
  it('round-trips', () => {
    const payload = { k: '2026-01-01T00:00:00.000Z', id: 'c-1' };
    expect(decodeCursor(encodeCursor(payload))).toEqual(payload);
  });

  it('rejects a tampered cursor rather than returning arbitrary rows', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow(InvalidCursorException);
  });
});
