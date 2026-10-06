import Feather from '@expo/vector-icons/Feather';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { SignInController } from '../auth/signInController';
import type { CodeError, EntryError, SignInState } from '../auth/signInMachine';
import { colors, fonts } from '../theme';
import { Button, Callout, Field, textStyles } from '../ui/kit';

const RESEND_SECONDS = 60;

const entryMessages: Record<EntryError, string> = {
  invalid_email: 'That does not look like an email address.',
  rate_limited: 'Too many tries. Wait a minute, then try again.',
  failed: 'Something went wrong sending the link. Try again.',
  link_expired: 'That link has expired or was already used. Enter your email for a fresh one.',
};

const codeMessages: Record<CodeError, string> = {
  invalid: 'That code is not right. Check the email and try again.',
  // GoTrue answers a wrong code with the same error as an old one, so the message covers both.
  expired: 'That code is wrong or has expired. Check the email, or tap resend for a new one.',
  offline: 'You are offline. Connect and try again.',
  failed: 'Could not check the code. Try again.',
};

function Logo() {
  return (
    <Image accessibilityLabel="Hearthread" source={require('../../assets/icon.png')} style={styles.logo} />
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.frame} keyboardShouldPersistTaps="handled">
        <Logo />
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const Heading = ({ children, small }: { children: string; small?: boolean }) => (
  <Text accessibilityRole="header" style={[textStyles.heading, small && { fontSize: 28 }]}>
    {children}
  </Text>
);

function CodeEntry({ state, controller }: { state: Extract<SignInState, { name: 'sent' }>; controller: SignInController }) {
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const change = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6) void controller.submitCode(digits);
  };

  return (
    <>
      <Text style={textStyles.kicker}>Link sent</Text>
      <Heading>Check your email</Heading>
      <Text style={textStyles.body}>
        We sent a link to <Text style={styles.strong}>{state.email}</Text>. Open it on{' '}
        <Text style={styles.strong}>this phone</Text>. It works once and expires in 15 minutes.
      </Text>
      <View>
        <Text style={styles.label}>Or enter the 6-digit code from the email</Text>
        <TextInput
          accessibilityLabel="6-digit code"
          value={code}
          onChangeText={change}
          editable={!state.verifying}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          placeholder="······"
          placeholderTextColor={colors.subtle}
          selectionColor={colors.accent}
          style={[styles.code, state.error && { borderColor: colors.danger }]}
        />
      </View>
      {state.verifying ? <ActivityIndicator color={colors.accent} /> : null}
      {state.error ? <Callout tone="bad" icon="alert-circle">{codeMessages[state.error]}</Callout> : null}
      <Pressable
        accessibilityRole="button"
        disabled={cooldown > 0}
        onPress={() => {
          setCooldown(RESEND_SECONDS);
          void controller.submitEmail();
        }}
      >
        <Text style={[textStyles.link, cooldown > 0 && { color: colors.muted }]}>
          {cooldown > 0 ? `Resend in 0:${String(cooldown).padStart(2, '0')}` : 'Resend the email'}
        </Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={controller.useOtherEmail}>
        <Text style={textStyles.link}>Use a different email</Text>
      </Pressable>
    </>
  );
}

export function SignInScreen({ state, controller }: { state: SignInState; controller: SignInController }) {
  switch (state.name) {
    case 'restoring':
    case 'signing_in':
      return (
        <SafeAreaView style={[styles.safe, styles.center]}>
          <Logo />
          <Heading small>{state.name === 'restoring' ? 'Opening…' : 'Signing you in…'}</Heading>
          {'email' in state && state.email ? <Text style={textStyles.body}>{state.email}</Text> : null}
          <ActivityIndicator color={colors.accent} />
        </SafeAreaView>
      );

    case 'sent':
      return (
        <Frame>
          <CodeEntry state={state} controller={controller} />
        </Frame>
      );

    case 'not_invited':
      return (
        <Frame>
          <Heading>{'Welcome\nback.'}</Heading>
          <View>
            <Text style={styles.label}>Email</Text>
            <View style={[styles.field, { borderColor: colors.danger }]}>
              <Text style={styles.fieldText}>{state.email}</Text>
            </View>
          </View>
          <Callout tone="bad" icon="alert-circle">
            <Text style={styles.strong}>This email isn’t on the invite list.</Text>
            {'\n'}Ask whoever invited you to add you, then try again.
          </Callout>
          <Button label="Try another email" onPress={controller.useOtherEmail} />
        </Frame>
      );

    case 'link_expired':
      return (
        <Frame>
          <Heading small>That link has expired</Heading>
          <Text style={textStyles.body}>
            Links work once and last 15 minutes. Get a fresh one for <Text style={styles.strong}>{state.email}</Text>.
          </Text>
          <Button label="Get a new link" onPress={() => void controller.submitEmail()} />
          <Pressable accessibilityRole="button" onPress={controller.useOtherEmail}>
            <Text style={textStyles.link}>Use a different email</Text>
          </Pressable>
        </Frame>
      );

    case 'offline':
      return (
        <Frame>
          <View style={styles.bubble}>
            <Feather name="wifi-off" size={30} color={colors.accent} />
          </View>
          <Heading small>You’re offline</Heading>
          <Text style={textStyles.body}>
            Signing in needs a connection the first time. Once you’re in, downloaded books play without one.
          </Text>
          <Button label="Try again" onPress={() => void controller.submitEmail()} />
        </Frame>
      );

    case 'entry':
    case 'sending':
    case 'access_ended':
    case 'signed_in': {
      const email = 'email' in state ? state.email : '';
      const error = state.name === 'entry' ? state.error : undefined;
      const sending = state.name === 'sending';
      return (
        <Frame>
          <Text style={textStyles.kicker}>Invite only</Text>
          <Heading>{'Welcome\nback.'}</Heading>
          <Text style={textStyles.body}>We’ll email you a one-tap link. No password to remember.</Text>
          <Field
            label="Email"
            value={email}
            onChangeText={controller.setEmail}
            onSubmitEditing={() => void controller.submitEmail()}
            editable={!sending}
            error={error === 'invalid_email'}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            placeholder="you@example.com"
            returnKeyType="send"
          />
          {error ? <Callout tone="bad" icon="alert-circle">{entryMessages[error]}</Callout> : null}
          <Button label="Send me a link" busy={sending} onPress={() => void controller.submitEmail()} />
          <Callout icon="lock">Invite-only. Only emails that have been added can sign in.</Callout>
        </Frame>
      );
    }
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 30 },
  frame: { padding: 26, paddingTop: 40, gap: 14 },
  logo: { width: 54, height: 54, borderRadius: 18 },
  strong: { fontFamily: fonts.sansBold, color: colors.text },
  label: { fontFamily: fonts.sansHeavy, fontSize: 10, letterSpacing: 0.8, textTransform: 'uppercase', color: colors.muted, marginBottom: 6 },
  field: { backgroundColor: colors.surf, borderRadius: 16, padding: 14, borderWidth: 1.5, borderColor: colors.line },
  fieldText: { fontFamily: fonts.sans, fontSize: 14, color: colors.text },
  code: { backgroundColor: colors.surf, borderRadius: 16, paddingVertical: 12, textAlign: 'center', letterSpacing: 10, fontSize: 24, fontFamily: fonts.serif, color: colors.text, borderWidth: 1.5, borderColor: colors.line },
  bubble: { width: 64, height: 64, borderRadius: 32, backgroundColor: colors.tint, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
});
