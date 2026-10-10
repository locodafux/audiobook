import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, Text, View, type DimensionValue } from 'react-native';

import { useCoverUri } from '../data/covers';
import type { BookRow } from '../data/types';
import { useServices } from '../servicesContext';
import { fonts, gradientFor } from '../theme';

/**
 * A book cover: the real picture once the phone has it (fetched through download-links, see data/covers.ts),
 * the book's gradient until then and for books without one. A `uri` prop overrides the lookup.
 */
export function Cover({
  book,
  width,
  uri: given,
  showTitle = true,
}: {
  book: Pick<BookRow, 'id' | 'title'>;
  width: DimensionValue;
  uri?: string;
  showTitle?: boolean;
}) {
  const stored = useCoverUri(useServices()?.covers, book.id);
  const uri = given ?? stored;
  const initial = book.title.replace(/^(the|a|an)\s+/i, '')[0]?.toUpperCase() ?? '?';
  return (
    <View style={[styles.frame, { width }]} accessibilityIgnoresInvertColors>
      {uri ? (
        <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      ) : (
        <LinearGradient colors={[...gradientFor(book.id)]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill}>
          <Text style={styles.initial}>{initial}</Text>
          {showTitle ? (
            <Text numberOfLines={3} style={styles.title}>
              {book.title}
            </Text>
          ) : null}
        </LinearGradient>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { aspectRatio: 2 / 3, borderRadius: 14, overflow: 'hidden', backgroundColor: '#20252e' },
  initial: { position: 'absolute', top: 8, left: 10, fontFamily: fonts.serif, fontSize: 30, color: 'rgba(255,255,255,0.9)' },
  title: { position: 'absolute', left: 9, right: 9, bottom: 9, fontFamily: fonts.serif, fontSize: 11.5, lineHeight: 16, color: '#fff' },
});
