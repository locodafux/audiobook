export type AppConfig = { supabaseUrl: string; supabaseAnonKey: string; audioProxyUrl: string };

/** Public values only: the Supabase URL and anon key, and where the audio proxy lives (no secret in it). Expo inlines EXPO_PUBLIC_* at build time. */
export function readConfig(): AppConfig | null {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const audioProxyUrl = process.env.EXPO_PUBLIC_AUDIO_PROXY_URL;
  return supabaseUrl && supabaseAnonKey && audioProxyUrl ? { supabaseUrl, supabaseAnonKey, audioProxyUrl } : null;
}
