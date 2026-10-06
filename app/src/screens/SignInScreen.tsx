import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { SignInController } from '../auth/signInController';
import type { EntryError, SignInState } from '../auth/signInMachine';
import { MIN_PASSWORD } from '../auth/username';
import { colors } from '../theme';
import { Button, Callout, Field, textStyles } from '../ui/kit';

const messages: Record<EntryError, string> = {
  username_invalid: 'A username is 3 to 20 letters, numbers or underscores.',
  password_short: `Use at least ${MIN_PASSWORD} characters for the password.`,
  password_mismatch: 'The two passwords are not the same.',
  invalid_login: 'That username and password do not match.',
  username_taken: 'That username is taken. Pick another one.',
  registration_full: 'Too many requests are waiting right now. Try again later.',
  rate_limited: 'Too many tries. Wait a minute, then try again.',
  offline: 'You are offline. Connect and try again.',
  failed: 'Something went wrong. Try again.',
};

function Logo() {
  return <Image accessibilityLabel="Hearthread" source={require('../../assets/icon.png')} style={styles.logo} />;
}

/** Log in or ask for an account. The typed values stay here; the controller owns the flow. */
export function SignInScreen({ state, controller }: { state: SignInState; controller: SignInController }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  if (state.name !== 'entry') {
    return (
      <SafeAreaView style={[styles.safe, styles.center]}>
        <Logo />
        <Text accessibilityRole="header" style={[textStyles.heading, { fontSize: 28 }]}>
          {state.name === 'restoring' ? 'Opening…' : 'Signing you in…'}
        </Text>
        <ActivityIndicator color={colors.accent} />
      </SafeAreaView>
    );
  }

  const register = state.mode === 'register';
  const submit = () => void (register ? controller.register(username, password, confirm) : controller.logIn(username, password));
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.frame} keyboardShouldPersistTaps="handled">
        <Logo />
        <Text style={textStyles.kicker}>Invite only</Text>
        <Text accessibilityRole="header" style={textStyles.heading}>
          {register ? 'Ask to\njoin.' : 'Welcome\nback.'}
        </Text>
        <Field
          label="Username"
          value={username}
          onChangeText={setUsername}
          editable={!state.busy}
          error={state.error === 'username_invalid' || state.error === 'username_taken'}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          editable={!state.busy}
          error={state.error === 'password_short' || state.error === 'invalid_login'}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={register ? 'new-password' : 'current-password'}
          textContentType={register ? 'newPassword' : 'password'}
          onSubmitEditing={register ? undefined : submit}
          returnKeyType={register ? 'next' : 'go'}
        />
        {register ? (
          <Field
            label="Confirm password"
            value={confirm}
            onChangeText={setConfirm}
            editable={!state.busy}
            error={state.error === 'password_mismatch'}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            onSubmitEditing={submit}
            returnKeyType="go"
          />
        ) : null}
        {state.error ? <Callout tone="bad" icon="alert-circle">{messages[state.error]}</Callout> : null}
        <Button label={register ? 'Send my request' : 'Log in'} busy={state.busy} onPress={submit} />
        <Pressable accessibilityRole="button" disabled={state.busy} onPress={() => controller.setMode(register ? 'login' : 'register')}>
          <Text style={textStyles.link}>{register ? 'I already have an account' : 'New here? Ask to join'}</Text>
        </Pressable>
        <Callout icon="lock">
          {register ? 'Someone has to approve your request before you can listen.' : 'Invite-only. New accounts need approval.'}
        </Callout>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 30 },
  frame: { padding: 26, paddingTop: 40, gap: 14 },
  logo: { width: 54, height: 54, borderRadius: 18 },
});
