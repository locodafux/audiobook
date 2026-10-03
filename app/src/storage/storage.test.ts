import { moveToFront, queueCounts, summarizeStorage, type PhoneBook, type QueueItem } from './ports';

const item = (id: string, status: QueueItem['status']): QueueItem => ({ id, bookId: 'b', bookTitle: 'B', chapterN: 1, chapterTitle: 'C', status });
const book = (bytes: number, finishedChapters: number, finishedBytes: number): PhoneBook => ({
  bookId: String(bytes), title: 'T', downloadedChapters: 3, totalChapters: 9, bytes, finishedChapters, finishedBytes,
});

describe('storage summary', () => {
  it('adds up used and freeable space', () => {
    expect(summarizeStorage([book(500, 4, 300), book(100, 0, 0), book(60, 5, 12)])).toEqual({ usedBytes: 660, freeableBytes: 312, freeableChapters: 9 });
    expect(summarizeStorage([])).toEqual({ usedBytes: 0, freeableBytes: 0, freeableChapters: 0 });
  });
});

describe('queue helpers', () => {
  it('counts by status', () => {
    expect(queueCounts([item('1', 'active'), item('2', 'queued'), item('3', 'queued'), item('4', 'failed')])).toEqual({ active: 1, queued: 2, waiting: 0, failed: 1 });
  });

  it('moves an item to the front but behind the active one', () => {
    const q = [item('1', 'active'), item('2', 'queued'), item('3', 'queued')];
    expect(moveToFront(q, '3').map((i) => i.id)).toEqual(['1', '3', '2']);
    expect(moveToFront([item('2', 'queued'), item('3', 'queued')], '3').map((i) => i.id)).toEqual(['3', '2']);
    expect(moveToFront(q, 'nope').map((i) => i.id)).toEqual(['1', '2', '3']);
  });
});
