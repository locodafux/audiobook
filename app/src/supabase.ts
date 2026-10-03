import 'react-native-url-polyfill/auto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

import { chunkedSecureStorage } from './auth/secureStorage';
import type { AppConfig } from './config';

export function createSupabaseClient({ supabaseUrl, supabaseAnonKey }: AppConfig): SupabaseClient {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: chunkedSecureStorage(SecureStore),
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
}
