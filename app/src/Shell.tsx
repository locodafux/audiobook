import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

import type { LibraryApi } from './data/library';
import type { BookRow, ChapterRow } from './data/types';
import { useBookList } from './data/useBookList';
import { BookScreen } from './screens/BookScreen';
import { BrowseScreen } from './screens/BrowseScreen';
import { downloadedAsRows } from './downloads/store';
import { DownloadsScreen } from './screens/DownloadsScreen';
import { HomeScreen } from './screens/HomeScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { YouFlow } from './screens/YouFlow';
import { loadProfile, type Profile, type ProfileApi } from './profile/profile';
import { stubPorts, type PhonePorts } from './storage/ports';
import type { Bookmark } from './bookmarks/bookmarks';
import { useServices } from './servicesContext';
import { colors } from './theme';
import { MiniPlayer } from './ui/MiniPlayer';
import { TabBar, type TabKey } from './ui/TabBar';

/**
 * The signed-in app: four tabs and a book page on top.
 * ponytail: plain state instead of a router; move to expo-router when the player
 * and settings screens arrive and need deep links of their own.
 */
export function Shell({
  email,
  library,
  profileApi,
  ports: portsProp,
  onJumpToBookmark,
  onSignOut,
}: {
  email: string;
  library: LibraryApi;
  profileApi: ProfileApi;
  /** The download queue and file storage. Defaults to the real ones from the services, else the stub's empty states. */
  ports?: PhonePorts;
  /** Opens the player at a bookmark. Defaults to the real player. */
  onJumpToBookmark?: (bookmark: Bookmark) => void;
  onSignOut: () => void;
}) {
  const [profile, setProfile] = useState<Profile | null>(null);
  useEffect(() => {
    let live = true;
    void loadProfile(profileApi, AsyncStorage).then((p) => live && setProfile(p));
    return () => {
      live = false;
    };
  }, [profileApi]);
  const [tab, setTab] = useState<TabKey>('home');
  const [open, setOpen] = useState<BookRow | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);
  const services = useServices();
  const ports = portsProp ?? services?.ports ?? stubPorts;
  const books = useBookList(library);
  const list = books.state.status === 'ready' ? books.state.list.books : null;

  useEffect(() => {
    if (!open && !playerOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (playerOpen ? setPlayerOpen(false) : setOpen(null), true));
    return () => sub.remove();
  }, [open, playerOpen]);

  // Chapters from the library, or, offline, the ones on the phone.
  const rowsFor = useCallback(
    async (book: BookRow): Promise<ChapterRow[]> => {
      const rows = await library.listChapters(book.id).catch(() => null);
      return rows ?? (services ? downloadedAsRows(services.downloaded, book.id) : []);
    },
    [library, services],
  );
  const play = useCallback(
    async (book: BookRow, rows: ChapterRow[], n?: number, at?: number) => {
      if (!services) return;
      setPlayerOpen(true);
      await services.player.open(book, rows, n, at === undefined);
      if (at !== undefined) {
        services.player.seekTo(at);
        services.player.play();
      }
    },
    [services],
  );
  const jump = useMemo(
    () =>
      onJumpToBookmark ??
      ((b: Bookmark) => {
        const book = list?.find((x) => x.id === b.bookId);
        if (book) void rowsFor(book).then((rows) => play(book, rows, b.chapterN, b.positionS));
      }),
    [onJumpToBookmark, list, rowsFor, play],
  );

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
          <BookScreen book={open} volumes={volumes} library={library} onSelectVolume={setOpen} onBack={() => setOpen(null)} onJump={jump} onPlay={services ? (rows, n) => void play(open, rows, n) : undefined} />
        ) : tab === 'home' ? (
          <HomeScreen email={email} books={books} onOpen={setOpen} />
        ) : tab === 'browse' ? (
          <BrowseScreen books={books} onOpen={setOpen} />
        ) : tab === 'downloads' ? (
          <DownloadsScreen ports={ports} />
        ) : (
          <YouFlow email={email} profile={profile} books={list ?? []} storage={ports.storage} onSignOut={onSignOut} />
        )}
      </View>
      {playerOpen ? null : <MiniPlayer onOpen={() => setPlayerOpen(true)} />}
      <TabBar
        active={tab}
        onChange={(t) => {
          setOpen(null);
          setTab(t);
        }}
      />
      {playerOpen ? (
        <View style={StyleSheet.absoluteFill}>
          <PlayerScreen onClose={() => setPlayerOpen(false)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { flex: 1 },
});
