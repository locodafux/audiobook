import { Feather } from '@expo/vector-icons';
import type { ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts } from '../theme';

/** A bottom sheet over the current screen (speed, sleep timer, chapters, reading view). */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) + 8 }]}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={onClose}>
            <Feather name="x" size={22} color={colors.muted} />
          </Pressable>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </Modal>
  );
}

/** A row of pill options; the selected one is filled. */
export function Pills<T extends string | number>({ options, value, onPick }: { options: readonly { value: T; label: string }[]; value: T | null; onPick: (v: T) => void }) {
  return (
    <View style={styles.pills}>
      {options.map((o) => (
        <Pressable key={String(o.value)} accessibilityRole="button" accessibilityState={{ selected: o.value === value }} onPress={() => onPick(o.value)} style={[styles.pill, o.value === value && { backgroundColor: colors.accent }]}>
          <Text style={[styles.pillText, o.value === value && { color: colors.onAccent }]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { maxHeight: '75%', backgroundColor: colors.surf, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 16 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  title: { fontFamily: fonts.serif, fontSize: 20, color: colors.text },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { paddingVertical: 9, paddingHorizontal: 15, borderRadius: 99, backgroundColor: colors.surf2 },
  pillText: { fontFamily: fonts.sansBold, fontSize: 12.5, color: colors.text },
});
