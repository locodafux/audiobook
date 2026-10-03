/** What the phone keeps about a chapter it has downloaded. Copied from the safe columns so the book works offline. */
export type DownloadedChapter = {
  bookId: string;
  n: number;
  title: string;
  bookTitle: string;
  durationS: number;
  bytes: number;
  sentenceCount: number;
  audioSha256: string;
  downloadedAt: number;
};

/** Book ids come from the server; only plain names may become folder names. */
export const isSafeBookId = (id: string) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(id) && !id.includes('..');

export const chapterKey = (bookId: string, n: number) => `${bookId}/${n}`;

const pad = (n: number) => String(n).padStart(4, '0');
export const audioPath = (bookId: string, n: number) => `books/${bookId}/ch-${pad(n)}.mp3`;
export const timingPath = (bookId: string, n: number) => `books/${bookId}/ch-${pad(n)}.timing.json`;
