import Feather from '@expo/vector-icons/Feather';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, themedStyles } from '../theme';
import { Button, textStyles } from '../ui/kit';

/** Shown when access was removed or the request was rejected. Downloaded files stay on the phone, locked, until sign-in. */
export function AccessEndedScreen({ onSignOut }: { onSignOut: () => void }) {
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Feather name="lock" size={36} color={colors.accent} />
        <Text style={textStyles.kicker}>Signed out</Text>
        <Text accessibilityRole="header" style={[textStyles.heading, { fontSize: 28 }]}>
          Your access has ended
        </Text>
        <Text style={textStyles.body}>
          This username is not approved. Ask the person who runs Hearthread if you think that’s a mistake.
        </Text>
        <Button label="Back to log in" onPress={onSignOut} />
      </View>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, justifyContent: 'center', gap: 12, paddingHorizontal: 26 },
}));
