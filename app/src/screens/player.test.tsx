import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { FlatList } from 'react-native';

import { fixtureBooks, fixtureLibrary, makeChapter } from '../data/fixtures';
import { fakeFiles, fakeLinks, fakeNetwork, memoryKv } from '../downloads/fakes';
import { createDownloadQueue } from '../downloads/queue';
import { createDownloadStore } from '../downloads/store';
import { audioPath, timingPath } from '../downloads/types';
import { createPlayerController } from '../player/controller';
import { fakeEngine } from '../player/fakeEngine';
import { createPositionStore } from '../player/position';
import { createBookmarksStore } from '../bookmarks/bookmarks';
import { createSettingsStore } from '../settings/settings';
import { createPhonePorts } from '../storage/phonePorts';
import { ServicesProvider, type Services } from '../servicesContext';
import { BookScreen } from './BookScreen';
import { PlayerScreen } from './PlayerScreen';

jest.mock('@expo/vector-icons/Feather', () => ({ __esModule: true, default: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const book = fixtureBooks[2]!;
const chapters = [1, 2].map((n) => makeChapter(book.id, n));
const toSentences = (texts: string[]) => texts.map((t, i) => ({ i, t, s: i * 4, e: i * 4 + 4 }));
const sentences = toSentences(['It was a quiet night.', 'The orchard slept.', 'Nobody came.']);

function services(have = [1], text = sentences, duration = 12) {
  const files = fakeFiles();
  const downloaded = createDownloadStore(memoryKv(), files);
  for (const n of have) {
    files.disk.set(audioPath(book.id, n), { bytes: 10, sha: 'x' });
    files.disk.set(timingPath(book.id, n), { bytes: 1, sha: '', text: JSON.stringify({ v: 1, sentences: text }) });
    downloaded.add({ bookId: book.id, n, title: `Chapter ${n}`, bookTitle: book.title, durationS: duration, bytes: 10, sentenceCount: text.length, audioSha256: 'x', downloadedAt: 0 });
  }
  const settings = createSettingsStore(memoryKv());
  const bookmarks = createBookmarksStore(memoryKv());
  const positions = createPositionStore(memoryKv());
  const engine = fakeEngine(duration);
  const player = createPlayerController({ engine, files, downloaded, positions, settings });
  const network = fakeNetwork({ connected: true, wifi: false }); // on mobile data: Wi-Fi-only holds downloads back
  const queue = createDownloadQueue({ kv: memoryKv(), files, links: fakeLinks({}), downloaded, settings, network });
  const ports = createPhonePorts({ downloaded, positions, queue, player, files, totalChapters: () => undefined });
  return { s: { settings, bookmarks, positions, downloaded, queue, player, ports } as Services, engine, network };
}

const wrap = (s: Services, ui: React.ReactElement) => <ServicesProvider value={s}>{ui}</ServicesProvider>;

describe('Player screen', () => {
  it('shows the chapter text and plays and pauses', async () => {
    const { s, engine } = services();
    await render(wrap(s, <PlayerScreen onClose={jest.fn()} />));
    await act(() => s.player.open(book, chapters, 1));
    expect(screen.getByText(/It was a quiet night/)).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Play'));
    expect(engine.playing).toBe(true);
    await fireEvent.press(screen.getByLabelText('Pause'));
    expect(engine.playing).toBe(false);
  });

  it('jumps to a sentence when it is tapped', async () => {
    const { s, engine } = services();
    await render(wrap(s, <PlayerScreen onClose={jest.fn()} />));
    await act(() => s.player.open(book, chapters, 1));
    await fireEvent.press(screen.getByText(/Nobody came/));
    expect(engine.position).toBe(8);
  });

  it('says when the chapter is not on the phone and offers the download', async () => {
    const { s } = services([1]);
    await render(wrap(s, <PlayerScreen onClose={jest.fn()} />));
    await act(() => s.player.open(book, chapters, 2));
    expect(screen.getByText('This chapter is not on your phone')).toBeTruthy();
    await fireEvent.press(screen.getByText('Download'));
    expect(s.queue.isQueued(book.id, 2)).toBe(true);
  });
});

describe('Player bookmark', () => {
  it('saves the sentence being read', async () => {
    const { s } = services();
    await render(wrap(s, <PlayerScreen onClose={jest.fn()} />));
    await act(() => s.player.open(book, chapters, 1));
    await fireEvent.press(screen.getByText(/Nobody came/));
    await fireEvent.press(screen.getByLabelText('Bookmark this spot'));
    expect(s.bookmarks.getState()).toMatchObject([{ bookId: book.id, chapterN: 1, positionS: 8, quote: 'Nobody came.' }]);
  });
});

describe('Player read-along follow', () => {
  afterEach(() => jest.useRealTimers());

  it('retries once from an estimated offset when the sentence row was never drawn', async () => {
    jest.useFakeTimers();
    const long = toSentences(Array.from({ length: 330 }, (_, i) => `Sentence number ${i}.`));
    const { s } = services([1], long, 1320);
    const toOffset = jest.spyOn(FlatList.prototype, 'scrollToOffset');
    await render(wrap(s, <PlayerScreen onClose={jest.fn()} />));
    await act(() => s.player.open(book, chapters, 1));
    toOffset.mockClear();
    const toIndex = jest.spyOn(FlatList.prototype, 'scrollToIndex');
    toIndex.mockClear();
    await act(async () => void s.player.seekToSentence(150)); // far past what the list has drawn
    expect(toOffset).toHaveBeenCalledTimes(1);
    await act(async () => void jest.advanceTimersByTime(150));
    expect(toIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 150 })); // the retry
    expect(toOffset.mock.calls.length).toBeLessThanOrEqual(2); // and it does not loop forever
    toOffset.mockRestore();
    toIndex.mockRestore();
  });
});

describe('Player seek bar', () => {
  it('can be stepped by a screen reader', async () => {
    const { s, engine } = services([1], sentences, 100);
    await render(wrap(s, <PlayerScreen onClose={jest.fn()} />));
    await act(() => s.player.open(book, chapters, 1));
    const bar = screen.getByLabelText('Position in chapter');
    await fireEvent(bar, 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(engine.position).toBeCloseTo(s.player.state.get().duration * 0.05);
    await fireEvent(bar, 'accessibilityAction', { nativeEvent: { actionName: 'decrement' } });
    expect(engine.position).toBeCloseTo(0);
  });
});

describe('Book page with chapters on the phone', () => {
  afterEach(() => jest.useRealTimers());
  const never = { listBooks: async () => [], getDescription: async () => null, listChapters: () => new Promise<never>(() => {}) };

  it('shows them at once when offline, without calling the server', async () => {
    const { s, network } = services([1]);
    network.set({ connected: false, wifi: false });
    s.queue.enqueue([]); // refreshes the queue's view of the connection
    const listChapters = jest.fn(never.listChapters);
    await render(wrap(s, <BookScreen book={book} volumes={[]} library={{ ...never, listChapters }} onSelectVolume={jest.fn()} onBack={jest.fn()} />));
    expect(await screen.findByLabelText(/Chapter 1,/)).toBeTruthy();
    expect(listChapters).not.toHaveBeenCalled();
  });

  it('gives up on a slow server after a few seconds and shows them', async () => {
    jest.useFakeTimers();
    const { s } = services([1]);
    await render(wrap(s, <BookScreen book={book} volumes={[]} library={never} onSelectVolume={jest.fn()} onBack={jest.fn()} />));
    expect(screen.queryByLabelText(/Chapter 1,/)).toBeNull();
    await act(async () => void jest.advanceTimersByTime(3100));
    expect(screen.getByLabelText(/Chapter 1,/)).toBeTruthy();
  });

  it('still waits for the server when nothing is on the phone', async () => {
    jest.useFakeTimers();
    const { s } = services([]);
    await render(wrap(s, <BookScreen book={book} volumes={[]} library={fixtureLibrary()} onSelectVolume={jest.fn()} onBack={jest.fn()} />));
    expect(await screen.findByLabelText(/Chapter 5,/)).toBeTruthy();
  });
});
