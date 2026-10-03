import type { Store } from '../phone/persisted';

// What the Downloads and storage screens need from the download/player worker (plan phase 5).
// The screens are written against these; `stubPorts` stands in until the real queue and file
// storage are wired in (Shell takes `ports` as a prop, so swapping is one line).

export type QueueItem = {
  id: string;
  bookId: string;
  bookTitle: string;
  chapterN: number;
  chapterTitle: string;
  /** `waiting`: no connection, resumes by itself. */
  status: 'active' | 'queued' | 'waiting' | 'failed';
  /** 0-1 for the active item (or a partly saved waiting one). */
  progress?: number;
  /** Why it failed, for the Failed section. */
  error?: string;
};

export type QueueSnapshot = {
  items: QueueItem[];
  paused: boolean;
  online: boolean;
  /** Why items are waiting, when not just "no connection" (e.g. Wi-Fi only). */
  note?: string;
  /** Active item only: for "1.3 MB left · 1.1 MB/s". */
  bytesLeft?: number;
  bytesPerSecond?: number;
};

export interface DownloadsPort extends Store<QueueSnapshot> {
  /** Moves a queued item to the front. */
  doFirst(id: string): void;
  /** Removes a queued or active item. */
  cancel(id: string): void;
  retry(id: string): void;
  retryAll(): void;
  pause(): void;
  resume(): void;
  cancelAll(): void;
}

export type PhoneBook = {
  bookId: string;
  title: string;
  downloadedChapters: number;
  totalChapters: number;
  bytes: number;
  /** Chapters listened to the end that "Clean up" would delete. */
  finishedChapters: number;
  finishedBytes: number;
};

export type StorageUsage = {
  books: PhoneBook[];
  /** Free space on the device. */
  freeBytes: number;
};

export interface StoragePort {
  usage(): Promise<StorageUsage>;
  /** Deletes the finished chapters of one book. */
  cleanUp(bookId: string): Promise<void>;
  /** Deletes all downloaded chapters of one book; position and bookmarks are kept. */
  remove(bookId: string): Promise<void>;
  /** Deletes every download and the listening progress on this phone (bookmarks are cleared by the screen). */
  clearAll(): Promise<void>;
}

export type PhonePorts = { downloads: DownloadsPort; storage: StoragePort };

/** Totals for the "312 MB can be freed" banner and the storage bar. */
export function summarizeStorage(books: readonly PhoneBook[]) {
  return {
    usedBytes: books.reduce((n, b) => n + b.bytes, 0),
    freeableBytes: books.reduce((n, b) => n + b.finishedBytes, 0),
    freeableChapters: books.reduce((n, b) => n + b.finishedChapters, 0),
  };
}

/** Counts for the queue header: "1 active · 3 queued · 1 failed". */
export function queueCounts(items: readonly QueueItem[]) {
  const count = (s: QueueItem['status']) => items.filter((i) => i.status === s).length;
  return { active: count('active'), queued: count('queued'), waiting: count('waiting'), failed: count('failed') };
}

/** Moves the item to the front of the waiting items (after any active one). Pure helper for the real queue. */
export function moveToFront(items: readonly QueueItem[], id: string): QueueItem[] {
  const target = items.find((i) => i.id === id);
  if (!target) return [...items];
  const rest = items.filter((i) => i.id !== id);
  const firstWaiting = rest.findIndex((i) => i.status !== 'active');
  const at = firstWaiting === -1 ? rest.length : firstWaiting;
  return [...rest.slice(0, at), target, ...rest.slice(at)];
}

const EMPTY_QUEUE: QueueSnapshot = { items: [], paused: false, online: true };
const noop = () => {};

/** Placeholder until phase 5: an empty queue and nothing stored on the phone. */
export const stubPorts: PhonePorts = {
  downloads: {
    getState: () => EMPTY_QUEUE,
    subscribe: () => noop,
    doFirst: noop,
    cancel: noop,
    retry: noop,
    retryAll: noop,
    pause: noop,
    resume: noop,
    cancelAll: noop,
  },
  storage: {
    usage: async () => ({ books: [], freeBytes: 0 }),
    cleanUp: async () => {},
    remove: async () => {},
    clearAll: async () => {},
  },
};
