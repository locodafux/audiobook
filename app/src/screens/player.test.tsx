import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { fixtureBooks, makeChapter } from '../data/fixtures';
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
import { PlayerScreen } from './PlayerScreen';

jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const book = fixtureBooks[2]!;
const chapters = [1, 2].map((n) => makeChapter(book.id, n));
const sentences = ['It was a quiet night.', 'The orchard slept.', 'Nobody came.'].map((t, i) => ({ i, t, s: i * 4, e: i * 4 + 4 }));

function services(have = [1]): { s: Services; engine: ReturnType<typeof fakeEngine> } {
  const files = fakeFiles();
  const downloaded = createDownloadStore(memoryKv(), files);
  for (const n of have) {
    files.disk.set(audioPath(book.id, n), { bytes: 10, sha: 'x' });
    files.disk.set(timingPath(book.id, n), { bytes: 1, sha: '', text: JSON.stringify({ v: 1, sentences }) });
    downloaded.add({ bookId: book.id, n, title: `Chapter ${n}`, bookTitle: book.title, durationS: 12, bytes: 10, sentenceCount: 3, audioSha256: 'x', downloadedAt: 0 });
  }
  const settings = createSettingsStore(memoryKv());
  const bookmarks = createBookmarksStore(memoryKv());
  const positions = createPositionStore(memoryKv());
  const engine = fakeEngine(12);
  const player = createPlayerController({ engine, files, downloaded, positions, settings });
  const network = fakeNetwork({ connected: true, wifi: false }); // on mobile data: Wi-Fi-only holds downloads back
  const queue = createDownloadQueue({ kv: memoryKv(), files, links: fakeLinks({}), downloaded, settings, network });
  const ports = createPhonePorts({ downloaded, positions, queue, player, files, totalChapters: () => undefined });
  return { s: { settings, bookmarks, positions, downloaded, queue, player, ports }, engine };
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
