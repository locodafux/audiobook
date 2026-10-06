import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AdminApi, MemberItem } from '../admin/adminApi';
import { AuthFlowError } from '../auth/authApi';
import { MIN_PASSWORD } from '../auth/username';
import { colors, fonts } from '../theme';
import { Button, Callout, EmptyState } from '../ui/kit';
import { BackHeader, Group } from '../ui/settingsKit';

type Load = { status: 'loading' } | { status: 'error'; offline: boolean } | { status: 'ready'; members: MemberItem[] };

/** Admin only: approve or reject new people, and set a new password for someone who forgot theirs. */
export function AdminScreen({ api, onBack }: { api: AdminApi; onBack: () => void }) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [resetting, setResetting] = useState<{ userId: string; password: string } | null>(null);

  const refresh = useCallback(
    () =>
      api.list().then(
        (members) => setLoad({ status: 'ready', members }),
        (e) => setLoad({ status: 'error', offline: e instanceof AuthFlowError && e.failure === 'offline' }),
      ),
    [api],
  );
  useEffect(() => void refresh(), [refresh]);

  /** Runs one admin action, then reloads the list. */
  const act = async (id: string, what: () => Promise<void>, done?: string) => {
    setBusy(id);
    setProblem(null);
    setNote(null);
    try {
      await what();
      if (done) setNote(done);
      setResetting(null);
      await refresh();
    } catch (e) {
      setProblem(e instanceof AuthFlowError && e.failure === 'offline' ? 'You are offline. Connect and try again.' : 'That did not work. Try again.');
    }
    setBusy(null);
  };

  const members = load.status === 'ready' ? load.members.filter((m) => !m.isAdmin) : [];
  const requests = members.filter((m) => m.status === 'pending');
  const others = members.filter((m) => m.status !== 'pending');

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <BackHeader title="Requests" onBack={onBack} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
        {problem ? <View style={styles.pad}><Callout tone="bad" icon="alert-circle">{problem}</Callout></View> : null}
        {note ? <View style={styles.pad}><Callout icon="check-circle">{note}</Callout></View> : null}
        {load.status === 'loading' ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : load.status === 'error' ? (
          <EmptyState
            icon="wifi-off"
            title={load.offline ? 'You’re offline' : 'Could not load the list'}
            body="Requests need a connection."
            action={<Button label="Try again" onPress={() => void refresh()} />}
          />
        ) : (
          <>
            <Group title="Waiting for approval">
              {requests.length === 0 ? <Text style={styles.empty}>No one is waiting.</Text> : null}
              {requests.map((m) => (
                <View key={m.userId} style={styles.item}>
                  <Text style={styles.name}>{m.username}</Text>
                  <View style={styles.actions}>
                    <View style={{ flex: 1 }}>
                      <Button label="Approve" busy={busy === m.userId} disabled={busy !== null} onPress={() => void act(m.userId, () => api.setStatus(m.userId, 'active'), `${m.username} can now sign in.`)} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button label="Reject" variant="ghost" disabled={busy !== null} onPress={() => void act(m.userId, () => api.setStatus(m.userId, 'revoked'))} />
                    </View>
                  </View>
                </View>
              ))}
            </Group>

            <Group title="People">
              {others.length === 0 ? <Text style={styles.empty}>No one else yet.</Text> : null}
              {others.map((m) => (
                <View key={m.userId} style={styles.item}>
                  <Text style={styles.name}>{m.username}</Text>
                  <Text style={styles.sub}>{m.status === 'active' ? 'Approved' : 'Rejected or removed'}</Text>
                  {resetting?.userId === m.userId ? (
                    <View style={{ gap: 8 }}>
                      <TextInput
                        accessibilityLabel={`New password for ${m.username}`}
                        value={resetting.password}
                        onChangeText={(password) => setResetting({ userId: m.userId, password })}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        placeholder={`New password (${MIN_PASSWORD}+ characters)`}
                        placeholderTextColor={colors.subtle}
                        selectionColor={colors.accent}
                        style={styles.input}
                      />
                      <View style={styles.actions}>
                        <View style={{ flex: 1 }}>
                          <Button
                            label="Set password"
                            busy={busy === m.userId}
                            disabled={busy !== null || resetting.password.length < MIN_PASSWORD}
                            onPress={() => void act(m.userId, () => api.resetPassword(m.userId, resetting.password), `New password set for ${m.username}. Tell them what it is.`)}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Button label="Cancel" variant="ghost" onPress={() => setResetting(null)} />
                        </View>
                      </View>
                    </View>
                  ) : (
                    <View style={styles.actions}>
                      <View style={{ flex: 1 }}>
                        <Button label="Reset password" variant="ghost" icon="key" disabled={busy !== null} onPress={() => setResetting({ userId: m.userId, password: '' })} />
                      </View>
                      {m.status === 'revoked' ? (
                        <View style={{ flex: 1 }}>
                          <Button label="Allow again" variant="ghost" disabled={busy !== null} onPress={() => void act(m.userId, () => api.setStatus(m.userId, 'active'))} />
                        </View>
                      ) : null}
                    </View>
                  )}
                </View>
              ))}
            </Group>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  pad: { paddingHorizontal: 20, paddingTop: 8 },
  empty: { fontFamily: fonts.sans, fontSize: 13, color: colors.muted, padding: 16 },
  item: { padding: 14, gap: 8 },
  name: { fontFamily: fonts.sansBold, fontSize: 15, color: colors.text },
  sub: { fontFamily: fonts.sans, fontSize: 12, color: colors.muted, marginTop: -4 },
  actions: { flexDirection: 'row', gap: 8 },
  input: { backgroundColor: colors.bg, borderRadius: 14, padding: 12, fontSize: 14, fontFamily: fonts.sans, color: colors.text, borderWidth: 1.5, borderColor: colors.line },
});
