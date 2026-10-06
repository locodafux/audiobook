export type AppConfig = { supabaseUrl: string; supabaseAnonKey: string };

/** Public values only: the Supabase URL and anon key. Expo inlines EXPO_PUBLIC_* at build time. */
export function readConfig(): AppConfig | null {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  return supabaseUrl && supabaseAnonKey ? { supabaseUrl, supabaseAnonKey } : null;
}
