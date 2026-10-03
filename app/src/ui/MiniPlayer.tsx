import { Feather } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useServices } from '../servicesContext';
import { useStore } from '../store';
import { colors, fonts } from '../theme';

/** The strip above the tab bar while a book is open: tap to expand, button to play or pause. */
export function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const services = useServices();
  if (!services) return null;
  return <Strip services={services} onOpen={onOpen} />;
}

function Strip({ services, onOpen }: { services: NonNullable<ReturnType<typeof useServices>>; onOpen: () => void }) {
  const s = useStore(services.player.state);
  if (!s.book || s.load === 'idle') return null;
  const chapter = s.chapters.find((c) => c.n === s.chapterN);
  const frac = s.duration > 0 ? s.position / s.duration : 0;
  return (
    <View style={styles.wrap}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open player, ${s.book.title}`} onPress={onOpen} style={styles.bar}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} style={styles.title}>
            {s.book.title}
          </Text>
          <Text numberOfLines={1} style={styles.sub}>
            {s.chapterN}. {chapter?.title ?? ''}
          </Text>
        </View>
        {s.load === 'ready' ? (
          <Pressable accessibilityRole="button" accessibilityLabel={s.playing ? 'Pause' : 'Play'} hitSlop={8} onPress={() => services.player.toggle()} style={styles.btn}>
            <Feather name={s.playing ? 'pause' : 'play'} size={20} color={colors.onAccent} />
          </Pressable>
        ) : null}
        <View style={[styles.progress, { width: `${frac * 100}%` }]} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingTop: 6, backgroundColor: colors.bg },
  bar: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surf2, borderRadius: 20, paddingVertical: 10, paddingHorizontal: 14, overflow: 'hidden' },
  title: { fontFamily: fonts.sansBold, fontSize: 13, color: colors.text },
  sub: { fontFamily: fonts.sans, fontSize: 11, color: colors.muted },
  btn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  progress: { position: 'absolute', left: 0, bottom: 0, height: 2, backgroundColor: colors.accent },
});
