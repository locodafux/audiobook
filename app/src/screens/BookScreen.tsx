import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { Bookmark } from '../bookmarks/bookmarks';
import { fetchDescription, readSavedDescription } from '../data/description';
import type { LibraryApi } from '../data/library';
import type { KeyValueStore } from '../data/offlineList';
import type { BookRow, ChapterRow } from '../data/types';
import { toJob } from '../downloads/autoDownload';
import { downloadedAsRows } from '../downloads/store';
import { formatBytes, formatDuration, plural } from '../format';
import { useServices, type Services } from '../servicesContext';
import { useStore } from '../store';
import { colors, fonts, themedStyles } from '../theme';
import { Cover } from '../ui/Cover';
import { Button, EmptyState } from '../ui/kit';
import { Segmented } from '../ui/settingsKit';
import { BookmarksTab } from './BookmarksTab';

const noStore: KeyValueStore = { getItem: async () => null, setItem: async () => {} };

/** With chapters already on the phone, how long a book page waits for the server before showing those. */
const SERVER_WAIT_MS = 3000;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

type Chapters = { status: 'loading' } | { status: 'error' } | { status: 'ready'; rows: ChapterRow[] };

/** Book page: cover, facts, volume switcher for a series, and the chapter list. */
export function BookScreen({
  book,
  volumes,
  library,
  descriptionStore,
  onSelectVolume,
  onBack,
  onJump = () => {},
  onPlay,
}: {
  book: BookRow;
  volumes: BookRow[];
  library: LibraryApi;
  /** Where the description is kept for offline. Without it the description needs the server every time. */
  descriptionStore?: KeyValueStore;
  onSelectVolume: (book: BookRow) => void;
  onBack: () => void;
  /** Opens the player at a bookmark (the player owns playback). */
  onJump?: (bookmark: Bookmark) => void;
  /** Opens the player on this book (at chapter `n`, or at the saved place). Only with the player wired in. */
  onPlay?: (rows: ChapterRow[], n?: number) => void;
}) {
  const services = useServices();
  const [tab, setTab] = useState<'chapters' | 'bookmarks'>('chapters');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; rows: ChapterRow[] | null } | null>(null);
  const key = `${book.id}:${attempt}`;

  useEffect(() => {
    let live = true;
    // Chapters on the phone make the wait pointless when offline (skip the call) or slow (give up after a few seconds).
    const onPhone = services ? downloadedAsRows(services.downloaded, book.id).length > 0 : false;
    const fetched = !onPhone
      ? library.listChapters(book.id)
      : services?.queue.state.get().blocked === 'offline'
        ? Promise.reject(new Error('offline'))
        : within(library.listChapters(book.id), SERVER_WAIT_MS);
    fetched.then(
      (rows) => live && setResult({ key, rows }),
      () => live && setResult({ key, rows: null }),
    );
    return () => {
      live = false;
    };
  }, [library, services, book.id, key]);

  // The list leaves the long description out: show the copy saved on an earlier visit, then the fresh one.
  const [about, setAbout] = useState<{ id: string; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    const show = (text: string | null, saved = false) =>
      live && text && setAbout((a) => (saved && a?.id === book.id ? a : { id: book.id, text }));
    if (descriptionStore) void readSavedDescription(descriptionStore, book.id).then((t) => show(t, true));
    fetchDescription(library, descriptionStore ?? noStore, book.id).then((t) => show(t), () => {});
    return () => {
      live = false;
    };
  }, [library, descriptionStore, book.id]);
  const description = book.description || (about?.id === book.id ? about.text : null);

  // A result for another book (or an earlier attempt) counts as still loading.
  const offline = services && result?.key === key && !result.rows ? downloadedAsRows(services.downloaded, book.id) : [];
  const chapters: Chapters =
    result?.key !== key ? { status: 'loading' } : result.rows ? { status: 'ready', rows: result.rows } : offline.length ? { status: 'ready', rows: offline } : { status: 'error' };
  const load = () => setAttempt((n) => n + 1);

  const header = (
    <View>
      <View style={styles.head}>
        <Cover book={book} width={128} />
        <Text accessibilityRole="header" style={styles.title}>
          {book.title}
        </Text>
        <Text style={styles.author}>{[book.volume ? `Vol. ${book.volume}` : null, book.author].filter(Boolean).join(' · ')}</Text>
      </View>
      <View style={styles.stats}>
        <Stat value={formatDuration(book.total_duration_s) || 'Unknown'} label="total" />
        <Stat value={String(book.chapter_count)} label="chapters" />
      </View>
      {volumes.length > 1 ? (
        <View style={styles.volumes}>
          {volumes.map((v) => (
            <Pressable
              key={v.id}
              accessibilityRole="button"
              accessibilityState={{ selected: v.id === book.id }}
              onPress={() => onSelectVolume(v)}
              style={[styles.chip, v.id === book.id && styles.chipOn]}
            >
              <Text style={[styles.chipText, v.id === book.id && { color: colors.bg }]}>Vol. {v.volume ?? '?'}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {description ? <Text style={styles.about}>{description}</Text> : null}
      {services && onPlay && chapters.status === 'ready' ? <Actions services={services} book={book} rows={chapters.rows} onPlay={onPlay} /> : null}
      <View style={{ marginHorizontal: 20, marginTop: 20, marginBottom: 6 }}>
        <Segmented value={tab} options={['chapters', 'bookmarks'] as const} label={(t) => (t === 'chapters' ? 'Chapters' : 'Bookmarks')} onChange={setTab} />
      </View>
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} hitSlop={8} style={styles.back}>
        <Feather name="chevron-left" size={24} color={colors.text} />
      </Pressable>
      {tab === 'bookmarks' ? (
        <FlatList data={[]} renderItem={null} ListHeaderComponent={header} ListFooterComponent={<BookmarksTab bookId={book.id} onJump={onJump} />} />
      ) : (
        <FlatList
          data={chapters.status === 'ready' ? chapters.rows : []}
          keyExtractor={(c) => String(c.n)}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingBottom: 24 }}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Chapter ${item.n}, ${item.title}`}
              disabled={!services || !onPlay}
              onPress={() => onPlay?.(chapters.status === 'ready' ? chapters.rows : [], item.n)}
              style={styles.chapter}
            >
              <Text style={styles.num}>{item.n}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={2} style={styles.chTitle}>
                  {item.title}
                </Text>
                <Text style={styles.chMeta}>{formatDuration(item.duration_s) || '< 1m'}</Text>
              </View>
              {services ? <ChapterState services={services} book={book} row={item} /> : null}
            </Pressable>
          )}
          ListEmptyComponent={
            chapters.status === 'loading' ? (
              <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
            ) : chapters.status === 'error' ? (
              <EmptyState
                icon="wifi-off"
                tone="danger"
                title="Chapters need a connection"
                body="Connect and try again."
                action={<Button label="Retry" variant="ghost" onPress={load} />}
              />
            ) : (
              <EmptyState icon="clock" title="No chapters are ready yet" body={`${plural(book.chapter_count, 'chapter')} are being prepared.`} />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

/** Play / Continue and Download all. */
function Actions({ services, book, rows, onPlay }: { services: Services; book: BookRow; rows: ChapterRow[]; onPlay: (rows: ChapterRow[], n?: number) => void }) {
  const { downloaded, queue, positions } = services;
  useStore(downloaded.state);
  useStore(queue.state);
  const saved = useStore(positions.state)[book.id];
  const missing = rows.filter((c) => !downloaded.has(book.id, c.n) && !queue.isQueued(book.id, c.n));
  const bytes = missing.reduce((sum, c) => sum + c.bytes, 0);
  const downloadAll = () =>
    Alert.alert(`Download ${plural(missing.length, 'chapter')}?`, `${formatBytes(bytes)} will be saved on this phone.`, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Download', onPress: () => queue.enqueue(missing.map((c) => toJob(book, c))) },
    ]);
  return (
    <View style={styles.actions}>
      <View style={{ flex: 1 }}>
        <Button label={saved ? 'Continue' : 'Play'} icon="play" onPress={() => onPlay(rows)} />
      </View>
      {missing.length ? (
        <View style={{ flex: 1 }}>
          <Button label="Download all" variant="ghost" icon="download" onPress={downloadAll} />
        </View>
      ) : null}
    </View>
  );
}

/** Per-chapter download state: on the phone, coming (with %), failed, or a download button. */
function ChapterState({ services: { downloaded, queue }, book, row }: { services: Services; book: BookRow; row: ChapterRow }) {
  const job = useStore(queue.state).jobs.find((j) => j.bookId === book.id && j.n === row.n);
  useStore(downloaded.state);
  if (downloaded.has(book.id, row.n)) return <Feather accessibilityLabel="On this phone" name="check-circle" size={18} color={colors.accent} />;
  if (job?.status === 'failed')
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="Download failed, tap to retry" onPress={() => queue.retry(book.id, row.n)} hitSlop={8} style={styles.failed}>
        <Feather name="alert-circle" size={18} color={colors.danger} />
        <Text style={styles.failedText}>Download failed, tap to retry</Text>
      </Pressable>
    );
  if (job) return <Text style={styles.chMeta}>{job.status === 'downloading' ? `${Math.round(job.progress * 100)}%` : 'Waiting'}</Text>;
  return <Feather accessibilityLabel="Download" name="download" size={18} color={colors.muted} onPress={() => queue.enqueue([toJob(book, row)])} />;
}

const Stat = ({ value, label }: { value: string; label: string }) => (
  <View style={styles.stat}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const styles = themedStyles(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  back: { padding: 12, alignSelf: 'flex-start' },
  head: { alignItems: 'center', gap: 6, paddingHorizontal: 20 },
  title: { fontFamily: fonts.serif, fontSize: 24, color: colors.text, textAlign: 'center', marginTop: 10 },
  author: { fontFamily: fonts.sans, fontSize: 13, color: colors.muted, textAlign: 'center' },
  stats: { flexDirection: 'row', gap: 10, marginHorizontal: 20, marginTop: 16 },
  stat: { flex: 1, backgroundColor: colors.surf, borderRadius: 16, paddingVertical: 10, alignItems: 'center' },
  statValue: { fontFamily: fonts.serif, fontSize: 18, color: colors.text },
  statLabel: { fontFamily: fonts.sansBold, fontSize: 12, color: colors.muted },
  volumes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: 20, marginTop: 14 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 99, backgroundColor: colors.surf },
  chipOn: { backgroundColor: colors.text },
  chipText: { fontFamily: fonts.sansBold, fontSize: 13, color: colors.muted },
  about: { fontFamily: fonts.sans, fontSize: 13, lineHeight: 20, color: colors.muted, marginHorizontal: 20, marginTop: 14 },
  actions: { flexDirection: 'row', gap: 10, marginHorizontal: 20, marginTop: 16 },
  chapter: { flexDirection: 'row', gap: 14, paddingVertical: 10, paddingHorizontal: 20, alignItems: 'center' },
  num: { width: 28, fontFamily: fonts.sansBold, fontSize: 13, color: colors.subtle },
  chTitle: { fontFamily: fonts.sansBold, fontSize: 13, color: colors.text },
  failed: { maxWidth: 120, alignItems: 'flex-end', gap: 2 },
  failedText: { fontFamily: fonts.sans, fontSize: 13, color: colors.danger, textAlign: 'right' },
  chMeta: { fontFamily: fonts.sans, fontSize: 13, color: colors.muted, marginTop: 2 },
}));
