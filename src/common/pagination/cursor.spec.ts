import { buildPage, decodeCursor } from './cursor';

interface Row {
  id: string;
  sortAt: string;
}

const row = (id: string, sortAt: string): Row => ({ id, sortAt });
const toCursor = (r: Row) => ({ k: r.sortAt, id: r.id });

describe('buildPage', () => {
  it('returns no cursor when the page is not full', () => {
    const rows = [row('a', '1'), row('b', '2')];

    const page = buildPage(rows, 5, toCursor);

    expect(page.data).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it('trims the probe row and points the cursor at the last returned row', () => {
    // Callers fetch limit + 1; the extra row only answers "is there more".
    const rows = [row('a', '1'), row('b', '2'), row('c', '3')];

    const page = buildPage(rows, 2, toCursor);

    expect(page.data.map((r) => r.id)).toEqual(['a', 'b']);
    // Cursoring on the probe row ('c') would skip it on the next page.
    expect(decodeCursor(page.nextCursor as string)).toEqual({ k: '2', id: 'b' });
  });

  it('returns an empty page rather than a cursor when there are no rows', () => {
    const page = buildPage([] as Row[], 10, toCursor);

    expect(page.data).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });
});
