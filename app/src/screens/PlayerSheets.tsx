import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { formatClock, formatDuration, formatSpeed } from '../format';
import type { PlayerController, PlayerState } from '../player/controller';
import { TEXT_SIZES, type Settings, type SettingsStore } from '../settings/settings';
import { colors, fonts } from '../theme';
import { Pills, Sheet } from '../ui/Sheet';

const SPEEDS = [0.8, 1, 1.1, 1.25, 1.5, 1.75, 2].map((value) => ({ value, label: formatSpeed(value) }));
const SLEEP = [
  { value: 'm15', label: '15 min' },
  { value: 'm30', label: '30 min' },
  { value: 'm45', label: '45 min' },
  { value: 'm60', label: '1 hour' },
  { value: 'chapter', label: 'End of chapter' },
] as const;

export function SpeedSheet({ player, state, settings, onClose }: { player: PlayerController; state: PlayerState; settings: Settings; onClose: () => void }) {
  const hasOverride = state.book ? settings.bookSpeeds[state.book.id] != null : false;
  return (
    <Sheet title="Speed" onClose={onClose}>
      <Pills options={SPEEDS} value={SPEEDS.find((s) => s.value === state.speed)?.value ?? null} onPick={(v) => player.setSpeed(v, 'book')} />
      <Text style={styles.hint}>
        {hasOverride ? 'This book has its own speed.' : `Using your default, ${formatSpeed(settings.speed)}.`} Picking a speed changes this book only.
      </Text>
      <View style={styles.actions}>
        <Pressable accessibilityRole="button" style={styles.link} onPress={() => player.setSpeed(state.speed, 'all')}>
          <Text style={styles.linkText}>Use {formatSpeed(state.speed)} for all books</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

export function SleepSheet({ player, state, onClose }: { player: PlayerController; state: PlayerState; onClose: () => void }) {
  const left = state.sleepLeftS;
  const pick = (v: (typeof SLEEP)[number]['value']) => {
    player.setSleep(v === 'chapter' ? 'chapter' : { minutes: Number(v.slice(1)) });
    onClose();
  };
  return (
    <Sheet title="Sleep timer" onClose={onClose}>
      {state.sleep ? (
        <View style={styles.row}>
          <Text style={styles.status}>{state.sleep.kind === 'chapter' ? 'Stops at the end of this chapter' : `Stops in ${formatClock(left ?? 0)}`}</Text>
          <Pressable accessibilityRole="button" style={styles.link} onPress={() => player.extendSleep()}>
            <Text style={styles.linkText}>+10 min</Text>
          </Pressable>
          <Pressable accessibilityRole="button" style={styles.link} onPress={() => (player.setSleep(null), onClose())}>
            <Text style={[styles.linkText, { color: colors.danger }]}>Turn off</Text>
          </Pressable>
        </View>
      ) : null}
      <Pills options={SLEEP} value={null} onPick={pick} />
      <Text style={styles.hint}>The voice fades out over the last 30 seconds.</Text>
    </Sheet>
  );
}

export function ChaptersSheet({ player, state, onClose, isOnPhone }: { player: PlayerController; state: PlayerState; onClose: () => void; isOnPhone: (n: number) => boolean }) {
  return (
    <Sheet title="Chapters" onClose={onClose}>
      {state.chapters.map((c) => (
        <Pressable key={c.n} accessibilityRole="button" accessibilityState={{ selected: c.n === state.chapterN }} onPress={() => (void player.openChapter(c.n, true), onClose())} style={styles.chapter}>
          <Text style={[styles.num, c.n === state.chapterN && { color: colors.accent }]}>{c.n}</Text>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={2} style={[styles.chTitle, c.n === state.chapterN && { color: colors.accent }]}>
              {c.title}
            </Text>
            <Text style={styles.hint}>
              {formatDuration(c.duration_s) || '< 1m'}
              {isOnPhone(c.n) ? '' : ' · not on this phone'}
            </Text>
          </View>
        </Pressable>
      ))}
    </Sheet>
  );
}

export function ReadingSheet({ settings, store, onClose }: { settings: Settings; store: SettingsStore; onClose: () => void }) {
  return (
    <Sheet title="Reading" onClose={onClose}>
      <Text style={styles.status}>Text size</Text>
      <Pills options={TEXT_SIZES.map((value) => ({ value, label: value[0]!.toUpperCase() + value.slice(1) }))} value={settings.textSize} onPick={(v) => store.update({ textSize: v })} />
      <View style={[styles.row, { marginTop: 18, justifyContent: 'space-between' }]}>
        <Text style={styles.status}>Follow the voice</Text>
        <Switch accessibilityLabel="Follow the voice" value={settings.follow} onValueChange={(v) => store.update({ follow: v })} trackColor={{ true: colors.accent, false: colors.raised }} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hint: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 17, color: colors.muted, marginTop: 8 },
  status: { fontFamily: fonts.sansBold, fontSize: 13, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14, flexWrap: 'wrap' },
  actions: { marginTop: 10 },
  link: { paddingVertical: 8 },
  linkText: { fontFamily: fonts.sansHeavy, fontSize: 12.5, color: colors.accent },
  chapter: { flexDirection: 'row', gap: 14, paddingVertical: 10, alignItems: 'center' },
  num: { width: 28, fontFamily: fonts.sansBold, fontSize: 13, color: colors.subtle },
  chTitle: { fontFamily: fonts.sansBold, fontSize: 13, color: colors.text },
});
