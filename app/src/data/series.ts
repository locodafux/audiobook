import type { BookRow } from './types';

export type LibraryEntry =
  | { kind: 'book'; key: string; book: BookRow }
  | { kind: 'series'; key: string; title: string; author: string | null; volumes: BookRow[] };

const byVolume = (a: BookRow, b: BookRow) =>
  (a.volume ?? Infinity) - (b.volume ?? Infinity) || a.title.localeCompare(b.title);

/**
 * One entry per series (volumes sorted), one per standalone book. A series with
 * a single published volume stays a plain book row. Entries keep the order in
 * which their first book appears.
 */
export function groupBooks(books: BookRow[]): LibraryEntry[] {
  const series = new Map<string, BookRow[]>();
  for (const b of books) {
    if (b.series_title) series.set(b.series_title, [...(series.get(b.series_title) ?? []), b]);
  }
  const seen = new Set<string>();
  const entries: LibraryEntry[] = [];
  for (const b of books) {
    const volumes = b.series_title ? series.get(b.series_title) : undefined;
    if (b.series_title && volumes && volumes.length > 1) {
      if (seen.has(b.series_title)) continue;
      seen.add(b.series_title);
      const sorted = [...volumes].sort(byVolume);
      entries.push({
        kind: 'series',
        key: `series:${b.series_title}`,
        title: b.series_title,
        author: sorted[0]?.author ?? null,
        volumes: sorted,
      });
    } else {
      entries.push({ kind: 'book', key: `book:${b.id}`, book: b });
    }
  }
  return entries;
}

/** Case-insensitive match on title, author or series; blank query matches all. */
export function filterBooks(books: BookRow[], query: string): BookRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return books;
  return books.filter((b) =>
    [b.title, b.author, b.series_title].some((f) => f?.toLowerCase().includes(q)),
  );
}

/** The first volume to open for an entry. */
export function entryBook(entry: LibraryEntry): BookRow {
  const first = entry.kind === 'book' ? entry.book : entry.volumes[0];
  if (!first) throw new Error('empty series entry');
  return first;
}
