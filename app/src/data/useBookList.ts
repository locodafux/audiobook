import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

import type { LibraryApi } from './library';
import { loadBookList, readSavedBookList, type BookList } from './offlineList';

export type BookListState =
  | { status: 'loading' }
  | { status: 'ready'; list: BookList; refreshing: boolean }
  | { status: 'error' };

type SetState = Dispatch<SetStateAction<BookListState>>;

async function fetchInto(api: LibraryApi, setState: SetState, isLive: () => boolean) {
  try {
    const list = await loadBookList(api, AsyncStorage);
    if (isLive()) setState({ status: 'ready', list, refreshing: false });
  } catch {
    if (isLive()) setState((s) => (s.status === 'ready' ? { ...s, refreshing: false } : { status: 'error' }));
  }
}

/** Shows the saved copy at once, then refreshes from the server. `refresh` re-asks (pull to refresh). */
export function useBookList(api: LibraryApi) {
  const [state, setState] = useState<BookListState>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    void (async () => {
      const saved = await readSavedBookList(AsyncStorage);
      if (live && saved) {
        setState((s) => (s.status === 'loading' ? { status: 'ready', list: { ...saved, source: 'cache' }, refreshing: true } : s));
      }
      await fetchInto(api, setState, () => live);
    })();
    return () => {
      live = false;
    };
  }, [api]);

  const refresh = useCallback(() => {
    setState((s) => (s.status === 'ready' ? { ...s, refreshing: true } : s));
    return fetchInto(api, setState, () => true);
  }, [api]);

  return { state, refresh };
}
