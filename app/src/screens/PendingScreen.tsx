import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors } from '../theme';
import { Button, EmptyState } from '../ui/kit';

/** Registered but not approved yet: the server shows this person nothing until an admin says yes. */
export function PendingScreen({ username, onCheck, onSignOut }: { username: string; onCheck: () => Promise<void>; onSignOut: () => void }) {
  const [checking, setChecking] = useState(false);
  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <EmptyState
          icon="clock"
          title="Waiting for approval"
          body={`Thanks, ${username}. Your request has been sent. You can listen as soon as it is approved. We check again whenever you open the app.`}
          action={
            <View style={{ alignSelf: 'stretch', gap: 10, marginTop: 8 }}>
              <Button
                label="Check again"
                busy={checking}
                onPress={() => {
                  setChecking(true);
                  void onCheck().finally(() => setChecking(false));
                }}
              />
              <Button label="Sign out" variant="ghost" onPress={onSignOut} />
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, justifyContent: 'center' },
});
