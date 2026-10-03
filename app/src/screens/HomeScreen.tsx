import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { groupBooks } from '../data/series';
import type { BookRow } from '../data/types';
import type { BookListState } from '../data/useBookList';
import { colors } from '../theme';
import { EmptyState, ScreenTitle, Skeleton } from '../ui/kit';
import { GridTile } from './BookCard';
import { CachedPill, LibraryError } from './LibraryStatus';

/** The library: every published book as a cover grid, series folded into one tile. */
export function HomeScreen({
  email,
  books,
  onOpen,
}: {
  email: string;
  books: { state: BookListState; refresh: () => void };
  onOpen: (book: BookRow) => void;
}) {
  const { state, refresh } = books;
  const entries = state.status === 'ready' ? groupBooks(state.list.books) : [];
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <FlatList
        key="grid"
        data={entries}
        keyExtractor={(e) => e.key}
        numColumns={2}
        columnWrapperStyle={styles.column}
        contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={state.status === 'ready' && state.refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />
        }
        ListHeaderComponent={
          <>
            <ScreenTitle sub={email}>Home</ScreenTitle>
            <CachedPill state={state} />
          </>
        }
        renderItem={({ item }) => <GridTile entry={item} onPress={onOpen} />}
        ListEmptyComponent={
          state.status === 'loading' ? (
            <View style={[styles.column, { gap: 14 }]}>
              {[0, 1].map((i) => (
                <View key={i} style={{ flex: 1, gap: 8 }}>
                  <Skeleton width="100%" height={200} radius={14} />
                  <Skeleton width="80%" height={12} />
                </View>
              ))}
            </View>
          ) : state.status === 'error' ? (
            <LibraryError onRetry={refresh} />
          ) : (
            <EmptyState
              icon="book"
              title="Nothing here yet"
              body="Books that have been published to the library show up here."
            />
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  column: { gap: 14, paddingHorizontal: 20, marginBottom: 16 },
});
