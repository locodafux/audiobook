import AsyncStorage from '@react-native-async-storage/async-storage';
// Per-weight imports: the package index would bundle every weight of both families.
import { Manrope_500Medium } from '@expo-google-fonts/manrope/500Medium';
import { Manrope_700Bold } from '@expo-google-fonts/manrope/700Bold';
import { Manrope_800ExtraBold } from '@expo-google-fonts/manrope/800ExtraBold';
import { Fraunces_700Bold } from '@expo-google-fonts/fraunces/700Bold';
import { useFonts } from 'expo-font';
import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import type { SupabaseClient } from '@supabase/supabase-js';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PhoneProvider, usePhone } from './phone/PhoneProvider';
import { supabaseProfile, type ProfileApi } from './profile/profile';
import { createSignInController } from './auth/signInController';
import { supabaseAuth } from './auth/supabaseAuth';
import { readConfig } from './config';
import { supabaseLibrary, type LibraryApi } from './data/library';
import { AccessEndedScreen } from './screens/AccessEndedScreen';
import { SignInScreen } from './screens/SignInScreen';
import { createServices } from './services';
import { ServicesProvider, type Services } from './servicesContext';
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
    return <SignedIn client={client} email={state.email} library={library} profileApi={profileApi} onSignOut={() => void controller.signOut()} />;
  }
  if (state.name === 'access_ended') {
    return <AccessEndedScreen onSignOut={() => void controller.signOut()} />;
  }
  return <SignInScreen state={state} controller={controller} />;
}

/** Builds the player and downloads once per sign-in, then shows the app. */
function SignedIn({ client, email, library, profileApi, onSignOut }: { client: SupabaseClient; email: string; library: LibraryApi; profileApi: ProfileApi; onSignOut: () => void }) {
  const phone = usePhone();
  const [services, setServices] = useState<Services | null>(null);
  useEffect(() => {
    let live = true;
    let made: Services | null = null;
    void createServices(client, phone).then((s) => {
      made = s;
      if (live) setServices(s);
    });
    // Save the place when the app goes to the background.
    const sub = AppState.addEventListener('change', (st) => st !== 'active' && made?.player.flush());
    return () => {
      live = false;
      sub.remove();
      made?.player.close();
    };
  }, [client, phone]);
  if (!services) return null;
  return (
    <ServicesProvider value={services}>
      <Shell email={email} library={library} profileApi={profileApi} onSignOut={onSignOut} />
    </ServicesProvider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: 30 },
  error: { fontFamily: fonts.sans, color: colors.text, textAlign: 'center', lineHeight: 20 },
});
