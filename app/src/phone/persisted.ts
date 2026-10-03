import { useSyncExternalStore } from 'react';

import type { KeyValueStore } from '../data/offlineList';

/** Anything a screen can read and re-render from. */
export interface Store<T> {
  getState(): T;
  subscribe(listener: () => void): () => void;
}

export interface PersistedStore<T> extends Store<T> {
  /** Replaces the state and saves it to the phone. Call `load` first. */
  set(update: (state: T) => T): void;
  /** Reads the saved copy once; garbage or a missing copy leaves the defaults, and an earlier `set` is kept. */
  load(): Promise<void>;
}

/**
 * One piece of phone-only data (settings, bookmarks, stats) saved as JSON under one key.
 * `sanitize` turns whatever was saved into valid state, so a bad or older copy never crashes the app.
 * ponytail: rewrites the whole value on every change; fine for a few KB, split per record if a store outgrows that.
 */
export function createPersisted<T>(
  kv: KeyValueStore,
  key: string,
  fallback: T,
  sanitize: (raw: unknown) => T,
): PersistedStore<T> {
  let state = fallback;
  let saving = Promise.resolve();
  let changed = false;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    set(update) {
      state = update(state);
      changed = true;
      emit();
      const json = JSON.stringify(state);
      saving = saving.then(() => kv.setItem(key, json)).catch(() => {});
    },
    async load() {
      try {
        const raw = await kv.getItem(key);
        // A change made before the saved copy arrived is newer than it, so it wins.
        if (raw && !changed) state = sanitize(JSON.parse(raw));
      } catch {
        // unreadable copy: keep the defaults
      }
      emit();
    },
  };
}

export const useStore = <T>(store: Store<T>): T => useSyncExternalStore(store.subscribe, store.getState);
