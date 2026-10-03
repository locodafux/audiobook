import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllPages } from './paging';
import {
  BOOK_COLUMNS,
  CHAPTER_COLUMNS,
  PAGE_SIZE,
  type BookRow,
  type ChapterRow,
} from './types';

/** The only way screens read the catalog; swap in fixtures for tests. */
export interface LibraryApi {
  listBooks(): Promise<BookRow[]>;
  listChapters(bookId: string): Promise<ChapterRow[]>;
}

export function supabaseLibrary(client: SupabaseClient): LibraryApi {
  return {
    async listBooks() {
      // Row-level security already limits this to published books for active members.
      return fetchAllPages<BookRow>(async (from, to) => {
        const { data, error } = await client
          .from('books')
          .select(BOOK_COLUMNS)
          .order('series_title', { nullsFirst: false })
          .order('volume')
          .order('title')
          .range(from, to)
          .returns<BookRow[]>();
        if (error) throw error;
        return data;
      }, PAGE_SIZE);
    },

    async listChapters(bookId) {
      return fetchAllPages<ChapterRow>(async (from, to) => {
        const { data, error } = await client
          .from('chapters')
          .select(CHAPTER_COLUMNS)
          .eq('book_id', bookId)
          .order('n')
          .range(from, to)
          .returns<ChapterRow[]>();
        if (error) throw error;
        return data;
      }, PAGE_SIZE);
    },
  };
}
