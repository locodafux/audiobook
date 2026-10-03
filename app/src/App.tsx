import AsyncStorage from '@react-native-async-storage/async-storage';
import { Manrope_500Medium, Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { Fraunces_700Bold } from '@expo-google-fonts/fraunces';
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PhoneProvider } from './phone/PhoneProvider';
import { supabaseProfile } from './profile/profile';
import { createSignInController } from './auth/signInController';
import { supabaseAuth } from './auth/supabaseAuth';
import { readConfig } from './config';
import { supabaseLibrary } from './data/library';
import { AccessEndedScreen } from './screens/AccessEndedScreen';
import { SignInScreen } from './screens/SignInScreen';
import { Shell } from './Shell';
import { createSupabaseClient } from './supabase';
import { colors, fonts, statusBarStyle } from './theme';

const config = readConfig();

export default function App() {
  const [fontsReady] = useFonts({ Manrope_500Medium, Manrope_700Bold, Manrope_800ExtraBold, Fraunces_700Bold });

  return (
    <SafeAreaProvider>
      <StatusBar style={statusBarStyle()} />
      {!fontsReady ? (
        <View style={styles.fill} />
      ) : config ? (
        <PhoneProvider kv={AsyncStorage}>
          <SignedInGate config={config} />
        </PhoneProvider>
      ) : (
        <View style={[styles.fill, styles.center]}>
          <Text style={styles.error}>
            Missing configuration. Copy .env.example to .env and set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.
          </Text>
        </View>
      )}
    </SafeAreaProvider>
  );
}

/** Wires Supabase to the sign-in controller and picks the screen for its state. */
function SignedInGate({ config }: { config: NonNullable<ReturnType<typeof readConfig>> }) {
  const { client, library, profileApi, controller } = useMemo(() => {
    const client = createSupabaseClient(config);
    return { client, library: supabaseLibrary(client), profileApi: supabaseProfile(client), controller: createSignInController(supabaseAuth(client)) };
  }, [config]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);

  useEffect(() => {
    let live = true;
    const urlSub = Linking.addEventListener('url', ({ url }) => void controller.openLink(url));
    void controller.start().then(async () => {
      const initial = await Linking.getInitialURL();
      if (live) await controller.openLink(initial);
    });
    const { data: auth } = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') controller.sessionLost();
    });
    // Keep the token fresh only while the app is open, and re-check the invite on return.
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') {
        void client.auth.startAutoRefresh();
        void controller.recheckAccess();
      } else {
        void client.auth.stopAutoRefresh();
      }
    });
    return () => {
      live = false;
      urlSub.remove();
      auth.subscription.unsubscribe();
      appSub.remove();
    };
  }, [client, controller]);

  if (state.name === 'signed_in') {
    return <Shell email={state.email} library={library} profileApi={profileApi} onSignOut={() => void controller.signOut()} />;
  }
  if (state.name === 'access_ended') {
    return <AccessEndedScreen onSignOut={() => void controller.signOut()} />;
  }
  return <SignInScreen state={state} controller={controller} />;
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: 30 },
  error: { fontFamily: fonts.sans, color: colors.text, textAlign: 'center', lineHeight: 20 },
});
