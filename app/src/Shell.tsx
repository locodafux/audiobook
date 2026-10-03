import { useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

import type { LibraryApi } from './data/library';
import type { BookRow } from './data/types';
import { useBookList } from './data/useBookList';
import { BookScreen } from './screens/BookScreen';
import { BrowseScreen } from './screens/BrowseScreen';
import { HomeScreen } from './screens/HomeScreen';
import { DownloadsScreen, YouScreen } from './screens/PlaceholderScreens';
import { colors } from './theme';
import { TabBar, type TabKey } from './ui/TabBar';

/**
 * The signed-in app: four tabs and a book page on top.
 * ponytail: plain state instead of a router; move to expo-router when the player
 * and settings screens arrive and need deep links of their own.
 */
export function Shell({ email, library, onSignOut }: { email: string; library: LibraryApi; onSignOut: () => void }) {
  const [tab, setTab] = useState<TabKey>('home');
  const [open, setOpen] = useState<BookRow | null>(null);
  const books = useBookList(library);
  const list = books.state.status === 'ready' ? books.state.list.books : null;

  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (setOpen(null), true));
    return () => sub.remove();
  }, [open]);

  const volumes = useMemo(
    () =>
      open?.series_title
        ? (list ?? []).filter((b) => b.series_title === open.series_title).sort((a, b) => (a.volume ?? 0) - (b.volume ?? 0))
        : [],
    [list, open],
  );

  return (
    <View style={styles.root}>
      <View style={styles.content}>
        {open ? (
          <BookScreen book={open} volumes={volumes} library={library} onSelectVolume={setOpen} onBack={() => setOpen(null)} />
        ) : tab === 'home' ? (
          <HomeScreen email={email} books={books} onOpen={setOpen} />
        ) : tab === 'browse' ? (
          <BrowseScreen books={books} onOpen={setOpen} />
        ) : tab === 'downloads' ? (
          <DownloadsScreen />
        ) : (
          <YouScreen email={email} onSignOut={onSignOut} />
        )}
      </View>
      <TabBar
        active={tab}
        onChange={(t) => {
          setOpen(null);
          setTab(t);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1 },
});
