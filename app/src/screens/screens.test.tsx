import { fireEvent, render, screen } from '@testing-library/react-native';

import { Shell } from '../Shell';

import { AuthFlowError, type AuthApi } from '../auth/authApi';
import { createSignInController } from '../auth/signInController';
import { fixtureBooks, fixtureLibrary, makeBook } from '../data/fixtures';
import type { BookListState } from '../data/useBookList';
import { BookScreen } from './BookScreen';
import { BrowseScreen } from './BrowseScreen';
import { HomeScreen } from './HomeScreen';
import { SignInScreen } from './SignInScreen';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../update/UpdateBanner', () => ({ UpdateBanner: () => null }));
jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('expo-linear-gradient', () => ({ LinearGradient: ({ children }: { children?: React.ReactNode }) => children ?? null }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});

const ready = (source: 'network' | 'cache' = 'network'): BookListState => ({
  status: 'ready',
  refreshing: false,
  list: { books: fixtureBooks, source, fetchedAt: Date.now() - 2 * 86_400_000 },
});

describe('Browse', () => {
  it('shows a series as one row and narrows with search', async () => {
    await render(<BrowseScreen books={{ state: ready(), refresh: jest.fn() }} onOpen={jest.fn()} />);
    expect(screen.getAllByText('Lantern Road')).toHaveLength(1);
    expect(screen.getByText('2 volumes')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search books'), 'orchard');
    expect(screen.queryByText('Lantern Road')).toBeNull();
    expect(screen.getByText('The Quiet Orchard')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search books'), 'dune');
    expect(screen.getByText('No match for "dune"')).toBeTruthy();
  });

  it('opens the first volume of a series', async () => {
    const onOpen = jest.fn();
    await render(<BrowseScreen books={{ state: ready(), refresh: jest.fn() }} onOpen={onOpen} />);
    await fireEvent.press(screen.getByLabelText(/^Lantern Road/));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'lantern-road-1' }));
  });

  it('says the list is a saved copy when offline', async () => {
    await render(<BrowseScreen books={{ state: ready('cache'), refresh: jest.fn() }} onOpen={jest.fn()} />);
    expect(screen.getByText('Offline · list from 2 days ago')).toBeTruthy();
  });

  it('shows the unreachable message with Retry when no list exists', async () => {
    const refresh = jest.fn();
    await render(<BrowseScreen books={{ state: { status: 'error' }, refresh }} onOpen={jest.fn()} />);
    await fireEvent.press(screen.getByText('Retry'));
    expect(refresh).toHaveBeenCalled();
  });
});

describe('Home', () => {
  it('shows the covers grid with the gradient fallback titles', async () => {
    await render(<HomeScreen email="ana@mail.com" books={{ state: ready(), refresh: jest.fn() }} onOpen={jest.fn()} />);
    expect(screen.getByText('ana@mail.com')).toBeTruthy();
    expect(screen.getAllByText('Small Habits').length).toBeGreaterThan(0);
  });

  it('shows the empty state for an empty library', async () => {
    const state: BookListState = { status: 'ready', refreshing: false, list: { books: [], source: 'network', fetchedAt: 0 } };
    await render(<HomeScreen email="a@b.co" books={{ state, refresh: jest.fn() }} onOpen={jest.fn()} />);
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
  });
});

describe('Book', () => {
  it('lists chapters and switches volume', async () => {
    const onSelectVolume = jest.fn();
    const [vol1, vol2] = fixtureBooks;
    await render(
      <BookScreen book={vol1!} volumes={[vol1!, vol2!]} library={fixtureLibrary(fixtureBooks, { 'lantern-road-1': 3 })} onSelectVolume={onSelectVolume} onBack={jest.fn()} />,
    );
    expect(await screen.findByText('Chapter 3')).toBeTruthy();
    await fireEvent.press(screen.getByText('Vol. 2'));
    expect(onSelectVolume).toHaveBeenCalledWith(vol2);
  });

  it('fetches the description on open (the list does not carry it)', async () => {
    const book = makeBook({ id: 'a', title: 'A' });
    const library = fixtureLibrary([makeBook({ id: 'a', title: 'A', description: 'A quiet story.' })]);
    await render(<BookScreen book={book} volumes={[]} library={library} onSelectVolume={jest.fn()} onBack={jest.fn()} />);
    expect(await screen.findByText('A quiet story.')).toBeTruthy();
  });

  it('shows the saved description offline for a book opened before', async () => {
    const book = makeBook({ id: 'a', title: 'A' });
    const library = { ...fixtureLibrary([book]), getDescription: async () => Promise.reject(new Error('offline')) };
    const store = { getItem: async () => 'A quiet story.', setItem: async () => {} };
    await render(<BookScreen book={book} volumes={[]} library={library} descriptionStore={store} onSelectVolume={jest.fn()} onBack={jest.fn()} />);
    expect(await screen.findByText('A quiet story.')).toBeTruthy();
  });

  it('offers Retry when chapters cannot be loaded', async () => {
    const library = { listBooks: async () => [], getDescription: async () => null, listChapters: jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue([]) };
    await render(<BookScreen book={fixtureBooks[2]!} volumes={[]} library={library} onSelectVolume={jest.fn()} onBack={jest.fn()} />);
    await fireEvent.press(await screen.findByText('Retry'));
    expect(await screen.findByText('No chapters are ready yet')).toBeTruthy();
  });
});

describe('Sign-in screen', () => {
  const api = (over: Partial<AuthApi> = {}): AuthApi => ({
    requestCode: async () => {},
    verifyCode: async () => {},
    exchangeLinkCode: async () => {},
    restoreSession: async () => null,
    checkAccess: async () => 'active',
    signOut: async () => {},
    ...over,
  });

  it('shows the invite-list message for a stranger', async () => {
    const controller = createSignInController(
      api({
        requestCode: async () => {
          throw new AuthFlowError('not_invited');
        },
      }),
    );
    await controller.start();
    controller.setEmail('dave@yahoo.com');
    await controller.submitEmail();
    await render(<SignInScreen state={controller.getState()} controller={controller} />);
    expect(screen.getByText('This email isn’t on the invite list.')).toBeTruthy();
  });

  it('asks for the 6-digit code after the link is sent', async () => {
    const controller = createSignInController(api());
    await controller.start();
    controller.setEmail('ana@mail.com');
    await controller.submitEmail();
    await render(<SignInScreen state={controller.getState()} controller={controller} />);
    expect(screen.getByText('Check your email')).toBeTruthy();
    expect(screen.getByLabelText('6-digit code')).toBeTruthy();
  });
});

describe('Shell', () => {
  it('keeps the Browse search when coming back from a book', async () => {
    await render(<Shell email="a@b.co" library={fixtureLibrary()} profileApi={{ get: async () => null }} onSignOut={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Browse'));
    await fireEvent.changeText(await screen.findByLabelText('Search books'), 'orchard');
    await fireEvent.press(await screen.findByText('The Quiet Orchard'));
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(screen.getByLabelText('Search books').props.value).toBe('orchard');
  });
});
