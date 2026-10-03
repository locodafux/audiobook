/** One spoken sentence: its text and where it starts and ends in the chapter audio, in seconds. */
export type Sentence = { i: number; t: string; s: number; e: number };

/**
 * Reads the timing file the generator writes next to each chapter (tech plan section 6):
 * `{ "v":1, "sentences":[{"i":0,"t":"...","s":0.00,"e":2.31}, ...] }`.
 * Throws on anything else so a bad file means "no read-along", never a crash while playing.
 */
export function parseTiming(json: unknown): Sentence[] {
  const doc = json as { v?: unknown; sentences?: unknown } | null;
  if (!doc || doc.v !== 1 || !Array.isArray(doc.sentences)) throw new Error('unsupported timing file');
  let prevEnd = 0;
  return doc.sentences.map((raw: unknown, idx) => {
    const x = raw as { i?: unknown; t?: unknown; s?: unknown; e?: unknown };
    if (typeof x?.t !== 'string' || typeof x.s !== 'number' || typeof x.e !== 'number' || !(x.s >= 0) || !(x.e >= x.s)) {
      throw new Error(`bad sentence ${idx}`);
    }
    if (x.s < prevEnd - 0.05) throw new Error(`sentence ${idx} starts before the previous one ends`);
    prevEnd = x.e;
    return { i: idx, t: x.t, s: x.s, e: x.e };
  });
}

/** Index of the sentence being spoken at `time` (the last one that has started); -1 when there are no sentences. */
export function sentenceIndexAt(sentences: readonly Sentence[], time: number): number {
  if (sentences.length === 0) return -1;
  let lo = 0;
  let hi = sentences.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (sentences[mid]!.s <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
