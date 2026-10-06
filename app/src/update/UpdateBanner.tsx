import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import appJson from '../../app.json';
import { colors, fonts } from '../theme';
import { checkForUpdate, type Update } from './updates';

const installed = appJson.expo.android.versionCode;

/** One check per launch; tapping opens the APK download, the cross hides it until the next launch. */
export function UpdateBanner({ check = () => checkForUpdate(installed) }: { check?: () => Promise<Update | null> }) {
  const [update, setUpdate] = useState<Update | null>(null);
  useEffect(() => {
    let live = true;
    void check().then((u) => live && setUpdate(u));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per launch
  }, []);
  if (!update) return null;
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(update.url)} style={styles.row}>
        <Feather name="download" size={16} color={colors.accent} />
        <Text style={styles.text}>Update available. Tap to download.</Text>
        <Pressable accessibilityLabel="Dismiss" hitSlop={10} onPress={() => setUpdate(null)}>
          <Feather name="x" size={16} color={colors.muted} />
        </Pressable>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.tint },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10 },
  text: { flex: 1, color: colors.text, fontFamily: fonts.sans, fontSize: 14 },
});
