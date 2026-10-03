// Row shapes for the "safe columns" the phone may read (tech plan, section 3).
// Hidden columns (audio_key, source_key, hashes, telegram ids, ...) are never
// selected: the column-level grants would refuse them anyway.

export type BookRow = {
  id: string;
  title: string;
  author: string | null;
  series_title: string | null;
  volume: number | null;
  description: string | null;
  language: string | null;
  cover_key: string | null;
  chapter_count: number;
  total_duration_s: number;
  total_bytes: number;
  status: 'published';
};

export type ChapterRow = {
  book_id: string;
  n: number;
  title: string;
  status: 'ready';
  duration_s: number;
  bytes: number;
  sentence_count: number;
  audio_sha256: string;
};

export const BOOK_COLUMNS =
  'id,title,author,series_title,volume,description,language,cover_key,chapter_count,total_duration_s,total_bytes,status';

export const CHAPTER_COLUMNS =
  'book_id,n,title,status,duration_s,bytes,sentence_count,audio_sha256';

/** PostgREST returns at most 1,000 rows per request (a book can have 1,300+ chapters), so read in blocks below that. */
export const PAGE_SIZE = 500;
