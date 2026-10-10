import { LinearGradient } from 'expo-linear-gradient';
import { Image, StyleSheet, Text, View, type DimensionValue } from 'react-native';

import type { BookRow } from '../data/types';
import { fonts, gradientFor } from '../theme';

/**
 * A book cover. Real covers are not served yet; until a `uri` is given, every book shows its gradient fallback.
 */
export function Cover({
  book,
  width,
  uri,
  showTitle = true,
}: {
  book: Pick<BookRow, 'id' | 'title'>;
  width: DimensionValue;
  uri?: string;
  showTitle?: boolean;
}) {
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
