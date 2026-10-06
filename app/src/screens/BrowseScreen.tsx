import Feather from '@expo/vector-icons/Feather';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { filterBooks, groupBooks } from '../data/series';
import type { BookRow } from '../data/types';
import type { BookListState } from '../data/useBookList';
import { colors, fonts } from '../theme';
import { EmptyState, ScreenTitle } from '../ui/kit';
import { BookRowItem } from './BookCard';
import { CachedPill, LibraryError, SkeletonRows } from './LibraryStatus';

/** Search the catalog by title, author or series; series are one row each. */
export function BrowseScreen({
  books,
  onOpen,
}: {
  books: { state: BookListState; refresh: () => void };
  onOpen: (book: BookRow) => void;
}) {
  const { state, refresh } = books;
  const [query, setQuery] = useState('');
  const all = state.status === 'ready' ? state.list.books : null;
  const entries = useMemo(() => groupBooks(filterBooks(all ?? [], query)), [all, query]);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <FlatList
        data={entries}
        keyExtractor={(e) => e.key}
        keyboardShouldPersistTaps="handled"
        windowSize={5}
        initialNumToRender={6}
        maxToRenderPerBatch={6}
        contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
        refreshControl={
          <RefreshControl refreshing={state.status === 'ready' && state.refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />
        }
        ListHeaderComponent={
          <>
            <ScreenTitle>Browse</ScreenTitle>
            <CachedPill state={state} />
            <View style={styles.search}>
              <Feather name="search" size={18} color={colors.muted} />
              <TextInput
                accessibilityLabel="Search books"
                value={query}
                onChangeText={setQuery}
                placeholder="Titles, authors, series…"
                placeholderTextColor={colors.muted}
                selectionColor={colors.accent}
                returnKeyType="search"
                autoCorrect={false}
                style={styles.input}
              />
              {query ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} hitSlop={10}>
                  <Feather name="x" size={18} color={colors.muted} />
                </Pressable>
              ) : null}
            </View>
            {all ? <Text style={styles.count}>{query ? `${entries.length} found` : `Available · ${all.length}`}</Text> : null}
          </>
        }
        renderItem={({ item }) => <BookRowItem entry={item} onPress={onOpen} />}
        ListEmptyComponent={
          state.status === 'loading' ? (
            <SkeletonRows />
          ) : state.status === 'error' ? (
            <LibraryError onRetry={refresh} />
          ) : query ? (
            <EmptyState icon="search" title={`No match for "${query.trim()}"`} body="Check the spelling, or ask whoever invited you to add it." />
          ) : (
            <EmptyState icon="book" title="Nothing here yet" body="Books that have been published to the library show up here." />
          )
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, marginVertical: 6, backgroundColor: colors.surf, borderRadius: 99, paddingHorizontal: 16 },
  input: { flex: 1, paddingVertical: 12, fontFamily: fonts.sans, fontSize: 13, color: colors.text },
  count: { fontFamily: fonts.sansBold, fontSize: 11.5, color: colors.muted, marginHorizontal: 20, marginTop: 10, marginBottom: 4 },
});
