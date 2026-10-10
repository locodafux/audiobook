import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState } from 'react';

import type { BookRow } from '../data/types';
import { usePhone } from '../phone/PhoneProvider';
import { useStore } from '../phone/persisted';
import { formatListened, summarize } from '../stats/stats';
import { colors, fonts, themedStyles } from '../theme';
import { EmptyState } from '../ui/kit';
import { BackHeader, Group, Row } from '../ui/settingsKit';

/** Listening: today, week, streak, all time and time per book. Phone only (wireframe G2). */
export function StatsScreen({ books, onBack }: { books: readonly BookRow[]; onBack: () => void }) {
  const [now] = useState(() => new Date());
  const sum = summarize(useStore(usePhone().stats), now);
  const title = (id: string) => books.find((b) => b.id === id)?.title ?? 'A book no longer in the library';
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <BackHeader title="Listening" onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <View style={styles.grid}>
          <Tile value={formatListened(sum.todayS)} label="today" />
          <Tile value={formatListened(sum.weekS)} label="this week" />
          <Tile value={`${sum.streakDays} ${sum.streakDays === 1 ? 'day' : 'days'}`} label="streak" />
          <Tile value={formatListened(sum.allTimeS)} label="all time" />
          <Tile value={String(sum.booksFinished)} label={sum.booksFinished === 1 ? 'book finished' : 'books finished'} />
        </View>
        <Text style={styles.note}>Kept on this phone only. Nothing is sent anywhere.</Text>
        {sum.byBook.length ? (
          <Group title="Time by book">
            {sum.byBook.map((b) => (
              <Row key={b.bookId} title={title(b.bookId)} right={<Text style={styles.time}>{formatListened(b.seconds)}</Text>} />
            ))}
          </Group>
        ) : (
          <EmptyState icon="headphones" title="No listening yet" body="Your time per book shows up here once you start listening." />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const Tile = ({ value, label }: { value: string; label: string }) => (
  <View accessible accessibilityLabel={`${value} ${label}`} style={styles.tile}>
    <Text style={styles.value}>{value}</Text>
    <Text style={styles.label}>{label}</Text>
  </View>
);

const styles = themedStyles(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 20, marginTop: 6 },
  tile: { width: '47.5%', backgroundColor: colors.surf, borderRadius: 18, padding: 14 },
  value: { fontFamily: fonts.serif, fontSize: 22, color: colors.text },
  label: { fontFamily: fonts.sansBold, fontSize: 13, color: colors.muted, marginTop: 2 },
  note: { fontFamily: fonts.sans, fontSize: 13, color: colors.muted, marginHorizontal: 20, marginTop: 12 },
  time: { fontFamily: fonts.sansBold, fontSize: 13, color: colors.muted },
}));
