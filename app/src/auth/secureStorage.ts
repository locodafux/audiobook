/** The slice of expo-secure-store we use (so tests can fake it). */
export interface SecureStoreLike {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

// SecureStore refuses values over ~2 KB and a Supabase session is bigger, so a
// value is split into chunks stored as `key.0`, `key.1`, ... with the count in `key`.
const CHUNK_SIZE = 1800;

/** Storage adapter for supabase-js backed by the Android Keystore. */
export function chunkedSecureStorage(store: SecureStoreLike) {
  const remove = async (key: string) => {
    const count = Number(await store.getItemAsync(key));
    if (Number.isInteger(count)) {
      for (let i = 0; i < count; i++) await store.deleteItemAsync(`${key}.${i}`);
    }
    await store.deleteItemAsync(key);
  };

  return {
    async getItem(key: string): Promise<string | null> {
      const count = Number(await store.getItemAsync(key));
      if (!Number.isInteger(count) || count < 1) return null;
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await store.getItemAsync(`${key}.${i}`);
        if (part === null) return null; // torn write: treat as signed out
        parts.push(part);
      }
      return parts.join('');
    },
    async setItem(key: string, value: string): Promise<void> {
      await remove(key);
      const chunks = value.match(new RegExp(`[\\s\\S]{1,${CHUNK_SIZE}}`, 'g')) ?? [''];
      for (const [i, chunk] of chunks.entries()) await store.setItemAsync(`${key}.${i}`, chunk);
      await store.setItemAsync(key, String(chunks.length));
    },
    removeItem: remove,
  };
}
