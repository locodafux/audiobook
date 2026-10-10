import Feather from '@expo/vector-icons/Feather';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, themedStyles } from '../theme';
import type { IconName } from './kit';

export type TabKey = 'home' | 'browse' | 'downloads' | 'you';

const TABS: readonly { key: TabKey; icon: IconName; label: string }[] = [
  { key: 'home', icon: 'home', label: 'Home' },
  { key: 'browse', icon: 'compass', label: 'Browse' },
  { key: 'downloads', icon: 'download', label: 'Downloads' },
  { key: 'you', icon: 'user', label: 'You' },
];

/** The floating pill tab bar from the wireframes. */
export function TabBar({ active, onChange }: { active: TabKey; onChange: (tab: TabKey) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      <View style={styles.bar} accessibilityRole="tablist">
        {TABS.map(({ key, icon, label }) => {
          const on = key === active;
          return (
            <Pressable
              key={key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={label}
              onPress={() => onChange(key)}
              style={[styles.tab, on && { backgroundColor: colors.tint }]}
            >
              <Feather name={icon} size={21} color={on ? colors.accent : colors.muted} />
              <Text style={[styles.label, { color: on ? colors.accent : colors.muted }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 4, backgroundColor: colors.bg },
  bar: { flexDirection: 'row', backgroundColor: colors.surf, borderRadius: 26, padding: 6, borderWidth: 1, borderColor: colors.line },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 6, borderRadius: 20 },
  label: { fontFamily: fonts.sansBold, fontSize: 11.5 },
}));
