import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { usePhone } from '../phone/PhoneProvider';
import { useStore } from '../phone/persisted';
import type { Profile } from '../profile/profile';
import { accentLabel, themeLabel } from '../settings/labels';
import { formatListened, summarize } from '../stats/stats';
import { colors, fonts } from '../theme';
import { Button, ScreenTitle } from '../ui/kit';
import { ConfirmDialog, Group, Row } from '../ui/settingsKit';

export type YouRoute = 'stats' | 'playback' | 'downloads' | 'appearance';

const DAYS = 'MTWTFSS';

/** You: who you are, this week's listening, and the settings pages (wireframes G1, G7). */
export function YouScreen({
  email,
  profile,
  onSignOut,
  onOpen,
}: {
  email: string;
  profile: Profile | null;
  onSignOut: () => void;
  onOpen: (route: YouRoute) => void;
}) {
  const { settings, stats } = usePhone();
  const s = useStore(settings);
  const [now] = useState(() => new Date());
  const week = summarize(useStore(stats), now);
  const [confirmOut, setConfirmOut] = useState(false);
  const name = profile?.displayName || email;
  const peak = Math.max(...week.weekBars, 1);

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <ScreenTitle>You</ScreenTitle>
        <View style={styles.card}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{name[0]?.toUpperCase() ?? '?'}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={styles.name}>
              {name}
            </Text>
            <Text numberOfLines={1} style={styles.email}>
              {[email, profile?.invitedBy ? `invited by ${profile.invitedBy}` : null].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Listening this week, ${formatListened(week.weekS)}, ${week.streakDays} day streak`}
          onPress={() => onOpen('stats')}
          style={styles.card2}
        >
          <Text style={styles.kicker}>This week</Text>
          <Text style={styles.big}>{formatListened(week.weekS)}</Text>
          <Text style={styles.small}>{week.streakDays > 0 ? `${week.streakDays}-day streak` : 'No streak yet'}</Text>
          <View style={styles.bars}>
            {week.weekBars.map((v, i) => (
              <View key={i} style={styles.barCol}>
                <View style={[styles.bar, { height: Math.max(4, (v / peak) * 44), backgroundColor: v > 0 ? colors.accent : colors.raised }]} />
                <Text style={styles.day}>{DAYS[i]}</Text>
              </View>
            ))}
          </View>
        </Pressable>

        <Group title="Settings">
          <Row icon="sliders" title="Playback" sub={`Speed ${s.speed}× · skip ${s.skipBackS} s / ${s.skipForwardS} s`} onPress={() => onOpen('playback')} />
          <Row
            icon="download"
            title="Downloads & storage"
            sub={[s.wifiOnly ? 'Wi-Fi only' : 'Any connection', s.keepNextN ? `next ${s.keepNextN} chapters` : null].filter(Boolean).join(' · ')}
            onPress={() => onOpen('downloads')}
          />
          <Row icon="type" title="Reading & appearance" sub={`${themeLabel(s.theme)} · ${accentLabel(s.accent)}`} onPress={() => onOpen('appearance')} />
        </Group>

        <View style={{ marginHorizontal: 20, marginTop: 18 }}>
          <Button label="Sign out" variant="ghost" icon="log-out" onPress={() => setConfirmOut(true)} />
        </View>
      </ScrollView>
      <ConfirmDialog
        visible={confirmOut}
        icon="lock"
        title="Sign out?"
        body="Downloaded books stay on this phone but won't play until you sign in again. Your place in each book is kept."
        confirmLabel="Sign out"
        onConfirm={() => {
          setConfirmOut(false);
          onSignOut();
        }}
        onCancel={() => setConfirmOut(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  card: { flexDirection: 'row', gap: 12, alignItems: 'center', marginHorizontal: 20, marginTop: 6, padding: 14, backgroundColor: colors.surf, borderRadius: 20 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.sansHeavy, fontSize: 18, color: colors.onAccent },
  name: { fontFamily: fonts.sansBold, fontSize: 15, color: colors.text },
  email: { fontFamily: fonts.sans, fontSize: 11.5, color: colors.muted, marginTop: 1 },
  card2: { marginHorizontal: 20, marginTop: 12, padding: 16, backgroundColor: colors.surf, borderRadius: 20 },
  kicker: { fontFamily: fonts.sansHeavy, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase', color: colors.muted },
  big: { fontFamily: fonts.serif, fontSize: 26, color: colors.text, marginTop: 4 },
  small: { fontFamily: fonts.sans, fontSize: 12, color: colors.muted },
  bars: { flexDirection: 'row', gap: 8, marginTop: 14, alignItems: 'flex-end', height: 64 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  bar: { width: '100%', borderRadius: 6 },
  day: { fontFamily: fonts.sansBold, fontSize: 10, color: colors.subtle },
});
