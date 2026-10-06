import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { formatBytes } from '../format';
import { usePhone } from '../phone/PhoneProvider';
import { useStore } from '../phone/persisted';
import { ACCENTS, OPTIONS, SPEED_MAX, SPEED_MIN, SPEED_STEP, TEXT_SIZES, THEMES, clampSpeed } from '../settings/settings';
import {
  accentLabel,
  afterDaysLabel,
  chaptersLabel,
  minutesLabel,
  rewindLabel,
  secondsLabel,
  textSizeLabel,
  themeLabel,
} from '../settings/labels';
import { summarizeStorage, type StoragePort, type StorageUsage } from '../storage/ports';
import { accents, colors, fonts, palettes } from '../theme';
import { Button, Callout } from '../ui/kit';
import { BackHeader, ChoiceRow, ConfirmDialog, Group, Segmented, SwitchRow } from '../ui/settingsKit';

const Page = ({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) => (
  <SafeAreaView edges={['top']} style={styles.safe}>
    <BackHeader title={title} onBack={onBack} />
    <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>{children}</ScrollView>
  </SafeAreaView>
);

const PRESETS = [0.75, 1, 1.25, 1.5, 2];

/** Default speed, skip lengths, smart rewind, sleep default, auto-play (wireframe G3). */
export function PlaybackSettings({ onBack }: { onBack: () => void }) {
  const { settings } = usePhone();
  const s = useStore(settings);
  const nudge = (by: number) => settings.update({ speed: clampSpeed(s.speed + by) });
  return (
    <Page title="Playback" onBack={onBack}>
      <Group title="Default speed">
        <View style={styles.speed}>
          <Pressable accessibilityRole="button" accessibilityLabel="Slower" disabled={s.speed <= SPEED_MIN} onPress={() => nudge(-SPEED_STEP)} style={[styles.step, s.speed <= SPEED_MIN && { opacity: 0.4 }]}>
            <Feather name="minus" size={20} color={colors.text} />
          </Pressable>
          <Text accessibilityLabel={`Default speed ${s.speed} times`} accessibilityLiveRegion="polite" style={styles.speedValue}>
            {s.speed.toFixed(2).replace(/0$/, '')}×
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Faster" disabled={s.speed >= SPEED_MAX} onPress={() => nudge(SPEED_STEP)} style={[styles.step, s.speed >= SPEED_MAX && { opacity: 0.4 }]}>
            <Feather name="plus" size={20} color={colors.text} />
          </Pressable>
        </View>
        <View style={styles.presets}>
          {PRESETS.map((p) => (
            <Pressable
              key={p}
              accessibilityRole="button"
              accessibilityLabel={`Set speed ${p}`}
              accessibilityState={{ selected: s.speed === p }}
              onPress={() => settings.update({ speed: p })}
              style={[styles.preset, s.speed === p && { backgroundColor: colors.tint }]}
            >
              <Text style={[styles.presetText, s.speed === p && { color: colors.accent }]}>{p}×</Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.hint}>Applies to every book. Override it for one book from the player.</Text>
      </Group>
      <Group title="Controls">
        <ChoiceRow icon="rotate-ccw" title="Skip back" value={s.skipBackS} options={OPTIONS.skipBackS} label={secondsLabel} onChange={(v) => settings.update({ skipBackS: v })} />
        <ChoiceRow icon="rotate-cw" title="Skip forward" value={s.skipForwardS} options={OPTIONS.skipForwardS} label={secondsLabel} onChange={(v) => settings.update({ skipForwardS: v })} />
        <ChoiceRow icon="refresh-cw" title="Smart rewind on resume" sub="Rewinds a little after a long pause" value={s.smartRewindS} options={OPTIONS.smartRewindS} label={rewindLabel} onChange={(v) => settings.update({ smartRewindS: v })} />
        <ChoiceRow icon="moon" title="Default sleep timer" sub="Pre-selected in the sleep sheet" value={s.sleepDefaultMin} options={OPTIONS.sleepDefaultMin} label={minutesLabel} onChange={(v) => settings.update({ sleepDefaultMin: v })} />
        <SwitchRow icon="skip-forward" title="Auto-play next chapter" value={s.autoPlayNext} onChange={(v) => settings.update({ autoPlayNext: v })} />
      </Group>
    </Page>
  );
}

/** Wi-Fi only, keep-ahead downloads, auto-clean, storage, clear everything (wireframes G4, G8). */
export function DownloadsSettings({
  storage,
  onClearAll,
  onBack,
}: {
  storage: StoragePort;
  /** Also clears bookmarks and stats on this phone, after the storage port has cleared downloads and progress. */
  onClearAll: () => void;
  onBack: () => void;
}) {
  const { settings } = usePhone();
  const s = useStore(settings);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    storage.usage().then((u) => live && setUsage(u), () => {});
    return () => {
      live = false;
    };
  }, [storage]);
  const used = usage ? summarizeStorage(usage.books).usedBytes : 0;

  const clear = async () => {
    setConfirm(false);
    try {
      await storage.clearAll();
      onClearAll();
      setUsage((u) => (u ? { ...u, books: [] } : u));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  return (
    <Page title="Downloads & storage" onBack={onBack}>
      <Group title="Downloading">
        <SwitchRow icon="wifi" title="Wi-Fi only" sub="Never use mobile data for downloads" value={s.wifiOnly} onChange={(v) => settings.update({ wifiOnly: v })} />
        <ChoiceRow icon="zap" title="Keep next chapters ready" sub="Downloads ahead as you listen" value={s.keepNextN} options={OPTIONS.keepNextN} label={chaptersLabel} onChange={(v) => settings.update({ keepNextN: v })} />
      </Group>
      <Group title="Clean-up">
        <ChoiceRow icon="trash-2" title="Auto-delete finished chapters" sub="Removes a chapter this long after you finish it" value={s.autoCleanDays} options={OPTIONS.autoCleanDays} label={afterDaysLabel} onChange={(v) => settings.update({ autoCleanDays: v })} />
      </Group>
      <Group title="Storage">
        <View style={styles.storage}>
          <Text style={styles.hint}>Used by audiobooks</Text>
          <Text style={styles.speedValue}>{usage ? formatBytes(used) : '–'}</Text>
        </View>
      </Group>
      {failed ? (
        <View style={{ marginHorizontal: 20, marginTop: 14 }}>
          <Callout tone="bad" icon="alert-triangle">
            Couldn&apos;t clear the offline library. Try again.
          </Callout>
        </View>
      ) : null}
      <View style={{ marginHorizontal: 20, marginTop: 18 }}>
        <Button label="Clear offline library" variant="ghost" icon="trash-2" onPress={() => setConfirm(true)} />
      </View>
      <ConfirmDialog
        visible={confirm}
        icon="alert-triangle"
        danger
        title="Clear offline library?"
        body={`Deletes all${usage ? ` ${formatBytes(used)} of` : ''} downloaded audio and timing files, plus your progress and bookmarks on this phone. Books stay available to download again.`}
        confirmLabel="Clear"
        onConfirm={() => void clear()}
        onCancel={() => setConfirm(false)}
      />
    </Page>
  );
}

/** Theme, accent, text size, follow-the-audio (wireframe G5). Theme and accent apply when the app next opens. */
export function AppearanceSettings({ onBack }: { onBack: () => void }) {
  const { settings } = usePhone();
  const s = useStore(settings);
  const mode = s.theme === 'light' ? 'light' : s.theme === 'black' ? 'black' : 'dark';
  // "System" previews as dark; the real choice follows the phone when the app opens.
  const pal = palettes[mode];
  const accent = accents[s.accent][mode === 'light' ? 'light' : 'dark'];
  return (
    <Page title="Reading & appearance" onBack={onBack}>
      <View style={[styles.preview, { backgroundColor: pal.surf }]} accessibilityLabel="Preview">
        <Text style={[styles.previewText, { color: pal.text, fontSize: { small: 14, medium: 17, large: 21 }[s.textSize] }]}>
          He did not know yet that the mountain had been <Text style={{ color: accent }}>waiting for them.</Text>
        </Text>
      </View>
      <Group title="Theme">
        <View style={styles.pad}>
          <Segmented value={s.theme} options={THEMES} label={themeLabel} onChange={(v) => settings.update({ theme: v })} />
          <Text style={styles.hint}>Takes effect the next time you open the app.</Text>
        </View>
      </Group>
      <Group title="Accent colour">
        <View style={[styles.pad, styles.swatches]}>
          {ACCENTS.map((a) => (
            <Pressable
              key={a}
              accessibilityRole="radio"
              accessibilityLabel={accentLabel(a)}
              accessibilityState={{ selected: a === s.accent }}
              onPress={() => settings.update({ accent: a })}
              style={[styles.swatch, { backgroundColor: accents[a].dark }, a === s.accent && styles.swatchOn]}
            >
              {a === s.accent ? <Feather name="check" size={18} color="#0e1116" /> : null}
            </Pressable>
          ))}
        </View>
      </Group>
      <Group title="Reading">
        <ChoiceRow icon="type" title="Text size" value={s.textSize} options={TEXT_SIZES} label={textSizeLabel} onChange={(v) => settings.update({ textSize: v })} />
        <SwitchRow icon="align-left" title="Follow the audio" sub="Read-along text scrolls with the voice" value={s.follow} onChange={(v) => settings.update({ follow: v })} />
      </Group>
    </Page>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  speed: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
  speedValue: { fontFamily: fonts.serif, fontSize: 30, color: colors.text },
  step: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surf2, alignItems: 'center', justifyContent: 'center' },
  presets: { flexDirection: 'row', gap: 8, paddingHorizontal: 16 },
  preset: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 99, backgroundColor: colors.surf2 },
  presetText: { fontFamily: fonts.sansBold, fontSize: 12, color: colors.muted },
  hint: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, color: colors.muted, padding: 16, paddingTop: 10 },
  storage: { padding: 16, paddingBottom: 12 },
  pad: { padding: 14 },
  preview: { marginHorizontal: 20, marginTop: 6, padding: 18, borderRadius: 20 },
  previewText: { fontFamily: fonts.serif, lineHeight: 28 },
  swatches: { flexDirection: 'row', gap: 14 },
  swatch: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  swatchOn: { borderWidth: 3, borderColor: colors.text },
});
