import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, fonts } from '../theme';
import { Button, EmptyState, ScreenTitle } from '../ui/kit';

export function DownloadsScreen() {
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScreenTitle>Downloads</ScreenTitle>
      <EmptyState icon="download" title="Nothing downloaded yet" body="Downloading chapters to listen offline is coming in the next update." />
    </SafeAreaView>
  );
}

export function YouScreen({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScreenTitle>You</ScreenTitle>
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{email[0]?.toUpperCase() ?? '?'}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.label}>Signed in as</Text>
          <Text numberOfLines={1} style={styles.email}>
            {email}
          </Text>
        </View>
      </View>
      <View style={{ marginHorizontal: 20, marginTop: 14 }}>
        <Button label="Sign out" variant="ghost" icon="log-out" onPress={onSignOut} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  card: { flexDirection: 'row', gap: 12, alignItems: 'center', marginHorizontal: 20, marginTop: 6, padding: 14, backgroundColor: colors.surf, borderRadius: 20 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.sansHeavy, fontSize: 18, color: colors.onAccent },
  label: { fontFamily: fonts.sans, fontSize: 11, color: colors.muted },
  email: { fontFamily: fonts.sansBold, fontSize: 14, color: colors.text },
});
