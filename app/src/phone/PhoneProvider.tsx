import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { KeyValueStore } from '../data/offlineList';
import { createBookmarksStore, type BookmarksStore } from '../bookmarks/bookmarks';
import { createSettingsStore, type SettingsStore } from '../settings/settings';
import { createStatsStore, type StatsStore } from '../stats/stats';

/** The phone-only data (plan section 3): settings, bookmarks and listening stats. */
export type Phone = { settings: SettingsStore; bookmarks: BookmarksStore; stats: StatsStore };

export function createPhone(kv: KeyValueStore): Phone {
  return { settings: createSettingsStore(kv), bookmarks: createBookmarksStore(kv), stats: createStatsStore(kv) };
}

/** Resolves once every store has read its saved copy. */
export const loadPhone = (p: Phone) => Promise.all([p.settings.load(), p.bookmarks.load(), p.stats.load()]).then(() => p);

const Ctx = createContext<Phone | null>(null);

/** Loads the saved data, then shows the app. The player reads the same stores through `usePhone()`. */
export function PhoneProvider({ children, kv, phone }: { children: ReactNode; kv?: KeyValueStore; phone?: Phone }) {
  const value = useMemo(() => phone ?? createPhone(kv!), [phone, kv]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void loadPhone(value).then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, [value]);
  return ready ? <Ctx.Provider value={value}>{children}</Ctx.Provider> : null;
}

export function usePhone(): Phone {
  const phone = useContext(Ctx);
  if (!phone) throw new Error('usePhone must be used inside PhoneProvider');
  return phone;
}
