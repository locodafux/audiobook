import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { LibraryEntry } from '../data/series';
import { entryBook } from '../data/series';
import type { BookRow } from '../data/types';
import { formatDuration, plural } from '../format';
import { colors, fonts } from '../theme';
import { Cover } from '../ui/Cover';

export const entryTitle = (e: LibraryEntry) => (e.kind === 'series' ? e.title : e.book.title);
export const entryAuthor = (e: LibraryEntry) => (e.kind === 'series' ? e.author : e.book.author);

export function bookSubtitle(b: BookRow): string {
  const parts = [b.volume ? `Vol. ${b.volume}` : null, plural(b.chapter_count, 'chapter'), formatDuration(b.total_duration_s) || null];
  return parts.filter(Boolean).join(' · ');
}

export const entrySubtitle = (e: LibraryEntry) =>
  e.kind === 'series' ? plural(e.volumes.length, 'volume') : bookSubtitle(e.book);

/** Cover tile for the Home grid. */
export function GridTile({ entry, onPress }: { entry: LibraryEntry; onPress: (book: BookRow) => void }) {
  const book = entryBook(entry);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entryTitle(entry)}, ${entrySubtitle(entry)}`}
      onPress={() => onPress(book)}
      style={styles.tile}
    >
      <Cover book={book} width="100%" />
      <Text numberOfLines={2} style={styles.title}>
        {entryTitle(entry)}
      </Text>
      {entryAuthor(entry) ? (
        <Text numberOfLines={1} style={styles.author}>
          {entryAuthor(entry)}
        </Text>
      ) : null}
      <Text numberOfLines={1} style={styles.sub}>
        {entrySubtitle(entry)}
      </Text>
    </Pressable>
  );
}

/** List row for Browse. A series shows three stacked covers. */
export function BookRowItem({ entry, onPress }: { entry: LibraryEntry; onPress: (book: BookRow) => void }) {
  const book = entryBook(entry);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entryTitle(entry)}, ${entrySubtitle(entry)}`}
      onPress={() => onPress(book)}
      style={styles.row}
    >
      {entry.kind === 'series' ? (
        <View style={styles.stack}>
          {entry.volumes.slice(0, 3).map((v, i) => (
            <View key={v.id} style={[styles.stacked, { left: i * 7, top: i * 4, opacity: 1 - i * 0.2 }]}>
              <Cover book={v} width={48} showTitle={false} />
            </View>
          ))}
        </View>
      ) : (
        <Cover book={book} width={44} showTitle={false} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={2} style={[styles.title, { marginTop: 0 }]}>
          {entryTitle(entry)}
        </Text>
        {entryAuthor(entry) ? <Text style={styles.author}>{entryAuthor(entry)}</Text> : null}
        <Text style={styles.sub}>{entrySubtitle(entry)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, minWidth: 0, maxWidth: '50%' },
  title: { fontFamily: fonts.sansBold, fontSize: 12.5, color: colors.text, marginTop: 8 },
  author: { fontFamily: fonts.sans, fontSize: 11, color: colors.muted, marginTop: 1 },
  sub: { fontFamily: fonts.sans, fontSize: 10.5, color: colors.subtle, marginTop: 2 },
  row: { flexDirection: 'row', gap: 12, paddingVertical: 10, paddingHorizontal: 20, alignItems: 'center' },
  stack: { width: 62, height: 78 },
  stacked: { position: 'absolute' },
});
