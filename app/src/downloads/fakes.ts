import type { KeyValueStore } from '../data/offlineList';
import { createStore } from '../store';
import type { FileStore } from './files';
import type { ChapterLink, LinksApi } from './links';
import type { NetState, NetworkWatcher } from './network';

// In-memory stand-ins so the queue, storage and player logic run in jest without a phone or a server.

export const memoryKv = (initial: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } => {
  const data = { ...initial };
  return { data, getItem: async (k) => data[k] ?? null, setItem: async (k, v) => void (data[k] = v) };
};

export type Remote = { bytes: number; sha: string; text?: string };

export function fakeFiles(remote: Record<string, Remote> = {}, free = 10_000_000_000) {
  const disk = new Map<string, Remote>();
  const calls = { downloads: [] as string[] };
  const files: FileStore & { disk: typeof disk; remote: typeof remote; calls: typeof calls; free: number; failNext: Error | null; gate: Promise<void> | null } = {
    disk,
    remote,
    calls,
    free,
    failNext: null,
    gate: null,
    exists: (p) => disk.has(p),
    size: (p) => disk.get(p)?.bytes ?? null,
    readText: async (p) => {
      const f = disk.get(p);
      if (!f) throw new Error('missing');
      return f.text ?? '';
    },
    writeText: (p, text) => void disk.set(p, { bytes: text.length, sha: '', text }),
    async download(url, path, { onProgress, signal }) {
      calls.downloads.push(url);
      if (files.failNext) {
        const e = files.failNext;
        files.failNext = null;
        throw e;
      }
      const r = remote[url];
      if (!r) throw new Error('404');
      onProgress?.(r.bytes / 2, r.bytes);
      if (files.gate) await Promise.race([files.gate, new Promise((_, rej) => signal?.addEventListener('abort', () => rej(new Error('aborted'))))]);
      if (signal?.aborted) throw new Error('aborted');
      disk.set(path, r);
      onProgress?.(r.bytes, r.bytes);
    },
    sha256: async (p) => disk.get(p)?.sha ?? '',
    move(from, to) {
      disk.set(to, disk.get(from)!);
      disk.delete(from);
    },
    remove: (p) => void disk.delete(p),
    removeDir: (p) => {
      for (const k of [...disk.keys()]) if (k.startsWith(`${p}/`)) disk.delete(k);
    },
    uri: (p) => `file:///fake/${p}`,
    freeBytes: () => files.free,
  };
  return files;
}

export const fakeNetwork = (initial: NetState = { connected: true, wifi: true }): NetworkWatcher => createStore(initial);

export function fakeLinks(chapters: Record<number, { bytes: number; sha: string }>, now: () => number = Date.now) {
  const asked: number[][] = [];
  const api: LinksApi & { asked: number[][]; error: Error | null } = {
    asked,
    error: null,
    async chapterLinks(bookId, ns) {
      asked.push(ns);
      if (api.error) throw api.error;
      return ns
        .filter((n) => chapters[n])
        .map<ChapterLink>((n) => ({ n, audioUrl: `https://r2/${bookId}/${n}.mp3`, timingUrl: `https://r2/${bookId}/${n}.json`, bytes: chapters[n]!.bytes, sha256: chapters[n]!.sha, expiresAt: now() + 900_000 }));
    },
  };
  return api;
}
