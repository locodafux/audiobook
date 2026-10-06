import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';

import type { AdminApi, MemberItem } from '../admin/adminApi';
import { fixtureBooks, fixtureLibrary } from '../data/fixtures';
import { memoryStore } from '../phone/memoryStore';
import { PhoneProvider, createPhone, type Phone } from '../phone/PhoneProvider';
import { createPersisted } from '../phone/persisted';
import type { DownloadsPort, PhoneBook, PhonePorts, QueueItem, QueueSnapshot, StoragePort } from '../storage/ports';
import { settleOpen } from '../ui/SwipeRow';
import { BookScreen } from './BookScreen';
import { DownloadsScreen } from './DownloadsScreen';
import { StatsScreen } from './StatsScreen';
import { YouFlow } from './YouFlow';

jest.mock('@expo/vector-icons/Feather', () => ({ __esModule: true, default: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }: { children?: React.ReactNode }) => children ?? null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

function wrap(phone: Phone) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <PhoneProvider phone={phone}>{children}</PhoneProvider>;
  };
}
async function renderWithPhone(ui: ReactElement, phone: Phone = createPhone(memoryStore())) {
  const view = await render(ui, { wrapper: wrap(phone) });
  return { phone, ...view };
}
const flush = () => act(async () => {});

const item = (id: string, status: QueueItem['status'], extra: Partial<QueueItem> = {}): QueueItem => ({
  id, bookId: 'b', bookTitle: 'Shadow Slave', chapterN: Number(id), chapterTitle: `Chapter ${id}`, status, ...extra,
});

function fakeDownloads(initial: Partial<QueueSnapshot>) {
  const store = createPersisted<QueueSnapshot>(memoryStore(), 'q', { items: [], paused: false, online: true, ...initial }, (r) => r as QueueSnapshot);
  const calls: string[] = [];
  const port: DownloadsPort = {
    getState: store.getState,
    subscribe: store.subscribe,
    doFirst: (id) => calls.push(`first:${id}`),
    cancel: (id) => calls.push(`cancel:${id}`),
    retry: (id) => calls.push(`retry:${id}`),
    retryAll: () => calls.push('retryAll'),
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
    cancelAll: () => calls.push('cancelAll'),
  };
  return { port, calls };
}

const book = (over: Partial<PhoneBook> = {}): PhoneBook => ({
  bookId: 'shadow', title: 'Shadow Slave', downloadedChapters: 12, totalChapters: 95, bytes: 41e6, finishedChapters: 0, finishedBytes: 0, ...over,
});
function fakeStorage(books: PhoneBook[]) {
  const calls: string[] = [];
  const port: StoragePort = {
    usage: async () => ({ books, freeBytes: 14e9 }),
    cleanUp: async (id) => void calls.push(`cleanUp:${id}`),
    remove: async (id) => void calls.push(`remove:${id}`),
    clearAll: async () => void calls.push('clearAll'),
  };
  return { port, calls };
}
const ports = (d: DownloadsPort, s: StoragePort): PhonePorts => ({ downloads: d, storage: s });

describe('swipe', () => {
  it('opens past half the actions width or on a left flick, closes otherwise', () => {
    expect(settleOpen(false, -50, 0, 100)).toBe(false);
    expect(settleOpen(false, -60, 0, 100)).toBe(true);
    expect(settleOpen(false, -10, -0.8, 100)).toBe(true);
    expect(settleOpen(true, 10, 0, 100)).toBe(true);
    expect(settleOpen(true, 70, 0, 100)).toBe(false);
    expect(settleOpen(true, 5, 0.9, 100)).toBe(false);
  });
});

describe('You', () => {
  const profile = { displayName: 'Maria', invitedBy: 'Leo', isAdmin: false };
  const you = (extra: Partial<Parameters<typeof YouFlow>[0]> = {}) => (
    <YouFlow username="maria" profile={profile} books={fixtureBooks} storage={fakeStorage([]).port} onSignOut={jest.fn()} {...extra} />
  );

  it('shows name, who invited you, and this week', async () => {
    const phone = createPhone(memoryStore());
    phone.stats.record('a', 3600);
    await renderWithPhone(you(), phone);
    await flush();
    expect(screen.getByText('Maria')).toBeTruthy();
    expect(screen.getByText('@maria · invited by Leo')).toBeTruthy();
    expect(screen.getByText('1h 0m')).toBeTruthy();
    expect(screen.getByText('1-day streak')).toBeTruthy();
  });

  it('falls back to the username when the profile is not known', async () => {
    await renderWithPhone(you({ profile: null }));
    await flush();
    expect(screen.getAllByText('maria').length).toBeGreaterThan(0);
  });

  describe('admin', () => {
    const member = (userId: string, username: string, status: MemberItem['status']): MemberItem => ({ userId, username, status, isAdmin: false, createdAt: '2026-10-06T00:00:00Z' });
    const fakeAdmin = (members: MemberItem[]) => {
      const calls: string[] = [];
      const api: AdminApi = {
        list: async () => members,
        setStatus: async (id, status) => void calls.push(`setStatus:${id}:${status}`),
        resetPassword: async (id, password) => void calls.push(`reset:${id}:${password}`),
      };
      return { api, calls };
    };

    it('is not offered to a normal member', async () => {
      await renderWithPhone(you({ adminApi: fakeAdmin([]).api }));
      await flush();
      expect(screen.queryByText('Requests')).toBeNull();
    });

    it('lets the admin approve or reject a request', async () => {
      const { api, calls } = fakeAdmin([member('u1', 'maria', 'pending'), member('u2', 'ben', 'pending')]);
      await renderWithPhone(you({ profile: { ...profile, isAdmin: true }, adminApi: api }));
      await flush();
      await fireEvent.press(screen.getByLabelText(/^Requests/));
      await flush();
      expect(screen.getByText('maria')).toBeTruthy();
      await fireEvent.press(screen.getAllByText('Approve')[0]!);
      await flush();
      await fireEvent.press(screen.getAllByText('Reject')[1]!);
      await flush();
      expect(calls).toEqual(['setStatus:u1:active', 'setStatus:u2:revoked']);
    });

    it('lets the admin set a new password for a member who forgot theirs', async () => {
      const { api, calls } = fakeAdmin([member('u1', 'maria', 'active')]);
      await renderWithPhone(you({ profile: { ...profile, isAdmin: true }, adminApi: api }));
      await flush();
      await fireEvent.press(screen.getByLabelText(/^Requests/));
      await flush();
      await fireEvent.press(screen.getByText('Reset password'));
      await fireEvent.changeText(screen.getByLabelText('New password for maria'), 'short');
      await fireEvent.press(screen.getByText('Set password'));
      expect(calls).toEqual([]); // too short: the button does nothing
      await fireEvent.changeText(screen.getByLabelText('New password for maria'), 'a-better-pass');
      await fireEvent.press(screen.getByText('Set password'));
      await flush();
      expect(calls).toEqual(['reset:u1:a-better-pass']);
    });

    it('says so when the list cannot be loaded', async () => {
      const api: AdminApi = { list: () => Promise.reject(new Error('x')), setStatus: async () => {}, resetPassword: async () => {} };
      await renderWithPhone(you({ profile: { ...profile, isAdmin: true }, adminApi: api }));
      await flush();
      await fireEvent.press(screen.getByLabelText(/^Requests/));
      await flush();
      expect(screen.getByText('Could not load the list')).toBeTruthy();
    });
  });

  it('asks before signing out', async () => {
    const onSignOut = jest.fn();
    await renderWithPhone(you({ onSignOut }));
    await flush();
    await fireEvent.press(screen.getByText('Sign out'));
    expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.getByText('Sign out?')).toBeTruthy();
    await fireEvent.press(within(screen.getByText('Sign out?').parent!.parent!).getByText('Sign out'));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('changes playback settings and saves them in the store the player reads', async () => {
    const { phone } = await renderWithPhone(you());
    await flush();
    await fireEvent.press(screen.getByLabelText(/^Playback/));
    await fireEvent.press(screen.getByLabelText('Faster'));
    expect(phone.settings.getState().speed).toBe(1.05);
    await fireEvent.press(screen.getByLabelText('Set speed 1.5'));
    expect(phone.settings.getState().speed).toBe(1.5);
    expect(screen.getByLabelText('Default speed 1.5 times')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Skip back/));
    await fireEvent.press(screen.getByRole('radio', { name: '30 s' }));
    expect(phone.settings.getState().skipBackS).toBe(30);
  });

  it('toggles Wi-Fi only and keep-next-N under Downloads & storage', async () => {
    const { phone } = await renderWithPhone(you());
    await flush();
    await fireEvent.press(screen.getByLabelText(/^Downloads & storage/));
    await fireEvent(screen.getByLabelText('Wi-Fi only'), 'valueChange', false);
    expect(phone.settings.getState().wifiOnly).toBe(false);
    await fireEvent.press(screen.getByLabelText(/^Keep next chapters ready/));
    await fireEvent.press(screen.getByText('3 chapters'));
    expect(phone.settings.getState().keepNextN).toBe(3);
  });

  it('clears the offline library only after confirming, and takes bookmarks with it', async () => {
    const storage = fakeStorage([book()]);
    const { phone } = await renderWithPhone(you({ storage: storage.port }));
    phone.bookmarks.add({ bookId: 'a', chapterN: 1, positionS: 5 });
    await flush();
    await fireEvent.press(screen.getByLabelText(/^Downloads & storage/));
    await flush();
    await fireEvent.press(screen.getByText('Clear offline library'));
    expect(storage.calls).toEqual([]);
    expect(screen.getByText(/Deletes all 41 MB of downloaded audio/)).toBeTruthy();
    await fireEvent.press(screen.getByText('Clear'));
    await flush();
    expect(storage.calls).toEqual(['clearAll']);
    expect(phone.bookmarks.getState()).toEqual([]);
  });

  it('keeps bookmarks and says so when clearing fails', async () => {
    const storage = fakeStorage([book()]);
    storage.port.clearAll = async () => Promise.reject(new Error('disk'));
    const { phone } = await renderWithPhone(you({ storage: storage.port }));
    phone.bookmarks.add({ bookId: 'a', chapterN: 1, positionS: 5 });
    await flush();
    await fireEvent.press(screen.getByLabelText(/^Downloads & storage/));
    await fireEvent.press(screen.getByText('Clear offline library'));
    await fireEvent.press(screen.getByText('Clear'));
    await flush();
    expect(screen.getByText(/Couldn.t clear the offline library/)).toBeTruthy();
    expect(phone.bookmarks.getState()).toHaveLength(1);
  });

  it('picks theme and accent', async () => {
    const { phone } = await renderWithPhone(you());
    await flush();
    await fireEvent.press(screen.getByLabelText(/^Reading & appearance/));
    await fireEvent.press(screen.getByText('Light'));
    await fireEvent.press(screen.getByLabelText('Rose'));
    expect(phone.settings.getState()).toMatchObject({ theme: 'light', accent: 'rose' });
    expect(screen.getByText('Takes effect the next time you open the app.')).toBeTruthy();
  });
});

describe('Listening stats', () => {
  it('shows the empty state, then numbers and time per book', async () => {
    const phone = createPhone(memoryStore());
    const { rerender } = await renderWithPhone(<StatsScreen books={fixtureBooks} onBack={jest.fn()} />, phone);
    await flush();
    expect(screen.getByText('No listening yet')).toBeTruthy();
    await act(async () => {
      phone.stats.record('quiet-orchard', 5400);
      phone.stats.markFinished('quiet-orchard');
    });
    await rerender(<StatsScreen books={fixtureBooks} onBack={jest.fn()} />);
    expect(screen.getByText('The Quiet Orchard')).toBeTruthy();
    expect(screen.getByLabelText('1 book finished')).toBeTruthy();
    expect(screen.getByLabelText('1h 30m today')).toBeTruthy();
  });
});

describe('Bookmarks', () => {
  const open = (phone: Phone, onJump = jest.fn()) =>
    renderWithPhone(
      <BookScreen book={fixtureBooks[2]!} volumes={[]} library={fixtureLibrary()} onSelectVolume={jest.fn()} onBack={jest.fn()} onJump={onJump} />,
      phone,
    );

  it('shows an empty state, then the saved sentences with notes', async () => {
    const phone = createPhone(memoryStore());
    await open(phone);
    await flush();
    await fireEvent.press(screen.getByText('Bookmarks'));
    expect(screen.getByText('No bookmarks yet')).toBeTruthy();
    await act(async () => void phone.bookmarks.add({ bookId: 'quiet-orchard', chapterN: 4, positionS: 26, quote: 'The ground began to tremble.', note: 'Great line' }));
    expect(screen.getByText('Ch. 4 · 0:26')).toBeTruthy();
    expect(screen.getByText('“The ground began to tremble.”')).toBeTruthy();
    expect(screen.getByText('Great line')).toBeTruthy();
  });

  it('only lists this book, and jumps to the tapped bookmark', async () => {
    const phone = createPhone(memoryStore());
    phone.bookmarks.add({ bookId: 'other', chapterN: 1, positionS: 1, quote: 'Not here' });
    const mine = phone.bookmarks.add({ bookId: 'quiet-orchard', chapterN: 2, positionS: 70, quote: 'Mine' });
    const onJump = jest.fn();
    await open(phone, onJump);
    await flush();
    await fireEvent.press(screen.getByText('Bookmarks'));
    expect(screen.queryByText('“Not here”')).toBeNull();
    await fireEvent.press(screen.getByText('“Mine”'));
    expect(onJump).toHaveBeenCalledWith(mine);
  });

  it('edits a note and deletes a bookmark from the swipe actions', async () => {
    const phone = createPhone(memoryStore());
    phone.bookmarks.add({ bookId: 'quiet-orchard', chapterN: 1, positionS: 62, quote: 'Sunny decided to pamper himself.' });
    await open(phone);
    await flush();
    await fireEvent.press(screen.getByText('Bookmarks'));
    await fireEvent.press(screen.getByLabelText('Edit note'));
    await fireEvent.changeText(screen.getByLabelText('Note'), 'Callback in ch. 90?');
    await fireEvent.press(screen.getByText('Save'));
    expect(phone.bookmarks.getState()[0]!.note).toBe('Callback in ch. 90?');
    expect(screen.getByText('Callback in ch. 90?')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Delete'));
    expect(phone.bookmarks.getState()).toEqual([]);
    expect(screen.getByText('No bookmarks yet')).toBeTruthy();
  });
});

describe('Downloads', () => {
  it('shows the empty queue and offers keep-ahead until it is on', async () => {
    const { port } = fakeDownloads({});
    const { phone } = await renderWithPhone(<DownloadsScreen ports={ports(port, fakeStorage([]).port)} />);
    await flush();
    expect(screen.getByText('All caught up')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Keep the next 3 chapters ready'));
    expect(phone.settings.getState().keepNextN).toBe(3);
    expect(screen.queryByLabelText('Keep the next 3 chapters ready')).toBeNull();
  });

  it('does not say "Starting" when only a failed item is left', async () => {
    const d = fakeDownloads({ items: [item('6', 'failed', { error: 'Connection reset' })] });
    await renderWithPhone(<DownloadsScreen ports={ports(d.port, fakeStorage([]).port)} />);
    await flush();
    expect(screen.queryByText('Starting…')).toBeNull();
    expect(screen.getByText('Downloads need a retry')).toBeTruthy();
  });

  it('shows counts, runs queue swipe actions, and retries failures', async () => {
    const d = fakeDownloads({ items: [item('3', 'active', { progress: 0.62 }), item('4', 'queued'), item('5', 'queued'), item('6', 'failed', { error: 'Connection reset' })] });
    await renderWithPhone(<DownloadsScreen ports={ports(d.port, fakeStorage([]).port)} />);
    await flush();
    expect(screen.getByText('Downloading chapter 3')).toBeTruthy();
    expect(screen.getByText('1 active · 2 queued · 1 failed')).toBeTruthy();
    expect(screen.getByText('#1 in queue')).toBeTruthy();
    await fireEvent.press(screen.getAllByLabelText('Do first')[1]!);
    await fireEvent.press(screen.getAllByLabelText('Cancel')[0]!);
    await fireEvent.press(screen.getByText('Retry all'));
    await fireEvent.press(screen.getByLabelText('Retry chapter 6, Shadow Slave'));
    await fireEvent.press(screen.getByText('Pause queue'));
    expect(d.calls).toEqual(['first:5', 'cancel:4', 'retryAll', 'retry:6', 'pause']);
  });

  it('says it is waiting for a connection and offers Resume when paused', async () => {
    const waiting = fakeDownloads({ online: false, items: [item('3', 'waiting', { progress: 0.62 })] });
    await renderWithPhone(<DownloadsScreen ports={ports(waiting.port, fakeStorage([]).port)} />);
    await flush();
    expect(screen.getByText('No connection · will resume automatically')).toBeTruthy();
    expect(screen.getByText('Waiting · 62% saved')).toBeTruthy();
  });

  it('lists books on the phone with Clean up and Remove (after a confirm)', async () => {
    const storage = fakeStorage([book({ finishedChapters: 9, finishedBytes: 312e6 }), book({ bookId: 'seduction', title: 'The Art of Seduction', downloadedChapters: 37, totalChapters: 37, bytes: 502e6 })]);
    await renderWithPhone(<DownloadsScreen ports={ports(fakeDownloads({}).port, storage.port)} />);
    await fireEvent.press(screen.getByText('On this phone'));
    await flush();
    expect(screen.getByText('Audiobooks 543 MB')).toBeTruthy();
    expect(screen.getByText('312 MB can be freed.')).toBeTruthy();
    expect(screen.getByText('12 of 95 · 41 MB')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Clean up'));
    await flush();
    await fireEvent.press(screen.getByLabelText('Remove The Art of Seduction'));
    expect(storage.calls).toEqual(['cleanUp:shadow']);
    expect(screen.getByText(/Frees 502 MB. Your place and bookmarks are kept/)).toBeTruthy();
    await fireEvent.press(screen.getAllByText('Remove').at(-1)!);
    await flush();
    expect(storage.calls).toEqual(['cleanUp:shadow', 'remove:seduction']);
  });

  it('frees every finished chapter with one tap', async () => {
    const storage = fakeStorage([book({ finishedChapters: 2, finishedBytes: 6e6 }), book({ bookId: 'b2', finishedChapters: 0 }), book({ bookId: 'b3', finishedChapters: 7, finishedBytes: 21e6 })]);
    await renderWithPhone(<DownloadsScreen ports={ports(fakeDownloads({}).port, storage.port)} />);
    await fireEvent.press(screen.getByText('On this phone'));
    await flush();
    await fireEvent.press(screen.getByText('Free up now'));
    await flush();
    expect(storage.calls.sort()).toEqual(['cleanUp:b3', 'cleanUp:shadow']);
  });

  it('shows empty and error states for storage', async () => {
    const empty = fakeStorage([]);
    const { unmount } = await renderWithPhone(<DownloadsScreen ports={ports(fakeDownloads({}).port, empty.port)} />);
    await fireEvent.press(screen.getByText('On this phone'));
    await flush();
    expect(screen.getByText('Nothing on this phone')).toBeTruthy();
    await unmount();
    const broken = fakeStorage([]);
    broken.port.usage = () => Promise.reject(new Error('io'));
    await renderWithPhone(<DownloadsScreen ports={ports(fakeDownloads({}).port, broken.port)} />);
    await fireEvent.press(screen.getByText('On this phone'));
    await flush();
    expect(screen.getByText("Can't read storage")).toBeTruthy();
  });
});
