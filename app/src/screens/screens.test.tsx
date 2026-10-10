import { fireEvent, render, screen } from '@testing-library/react-native';

import { Shell } from '../Shell';
import { ServicesProvider, type Services } from '../servicesContext';
import { Cover } from '../ui/Cover';

import { AuthFlowError, type AuthApi } from '../auth/authApi';
import { createSignInController } from '../auth/signInController';
import { fixtureBooks, fixtureLibrary, makeBook } from '../data/fixtures';
import type { BookListState } from '../data/useBookList';
import { BookScreen } from './BookScreen';
import { BrowseScreen } from './BrowseScreen';
import { HomeScreen } from './HomeScreen';
import { PendingScreen } from './PendingScreen';
import { SignInScreen } from './SignInScreen';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('../update/UpdateBanner', () => ({ UpdateBanner: () => null }));
jest.mock('@expo/vector-icons/Feather', () => ({ __esModule: true, default: () => null }));
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
    await render(<HomeScreen username="ana" books={{ state: ready(), refresh: jest.fn() }} onOpen={jest.fn()} />);
    expect(screen.getByText('ana')).toBeTruthy();
    expect(screen.getAllByText('Small Habits').length).toBeGreaterThan(0);
  });

  it('shows the empty state for an empty library', async () => {
    const state: BookListState = { status: 'ready', refreshing: false, list: { books: [], source: 'network', fetchedAt: 0 } };
    await render(<HomeScreen username="abc" books={{ state, refresh: jest.fn() }} onOpen={jest.fn()} />);
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
  });
});

describe('Cover', () => {
  const store = (uri: string | undefined, want = jest.fn()) =>
    ({ covers: { uri: () => uri, want, subscribe: () => () => {} } }) as unknown as Services;

  it('shows the picture the phone has, without the gradient title', async () => {
    const want = jest.fn();
    await render(
      <ServicesProvider value={store('file:///fake/covers/small.jpg', want)}>
        <Cover book={{ id: 'small', title: 'Small Habits' }} width={100} />
      </ServicesProvider>,
    );
    expect(screen.queryByText('Small Habits')).toBeNull();
    expect(want).not.toHaveBeenCalled();
  });

  it('draws the gradient and asks for the picture while the phone has none', async () => {
    const want = jest.fn();
    await render(
      <ServicesProvider value={store(undefined, want)}>
        <Cover book={{ id: 'small', title: 'Small Habits' }} width={100} />
      </ServicesProvider>,
    );
    expect(screen.getByText('Small Habits')).toBeTruthy();
    expect(want).toHaveBeenCalledWith('small');
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
    register: async () => {},
    signIn: async () => {},
    restoreSession: async () => null,
    checkAccess: async () => 'active',
    signOut: async () => {},
    ...over,
  });
  const started = async (over: Partial<AuthApi> = {}) => {
    const controller = createSignInController(api(over));
    await controller.start();
    return controller;
  };
  /** Re-renders with the controller's current state, as App does through useSyncExternalStore. */
  const view = (controller: Awaited<ReturnType<typeof started>>) => <SignInScreen state={controller.getState()} controller={controller} />;

  it('logs in with a username and password, with no email or code anywhere', async () => {
    const signIn = jest.fn(async () => {});
    const controller = await started({ signIn });
    await render(view(controller));
    expect(screen.getByText('Log in')).toBeTruthy();
    expect(screen.queryByText(/email|code|link/i)).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Username'), 'Ana');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret-pass');
    await fireEvent.press(screen.getByText('Log in'));
    expect(signIn).toHaveBeenCalledWith('ana', 'secret-pass');
  });

  it('shows the message for a wrong password', async () => {
    const controller = await started({
      signIn: async () => {
        throw new AuthFlowError('invalid_login');
      },
    });
    const { rerender } = await render(view(controller));
    await fireEvent.changeText(screen.getByLabelText('Username'), 'ana');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'nope-nope');
    await fireEvent.press(screen.getByText('Log in'));
    await rerender(view(controller));
    expect(screen.getByText('That username and password do not match.')).toBeTruthy();
  });

  it('register asks for a confirmation and warns that approval is needed', async () => {
    const register = jest.fn(async () => {});
    const controller = await started({ register, checkAccess: async () => 'pending' });
    controller.setMode('register');
    const { rerender } = await render(view(controller));
    expect(screen.getByText('Someone has to approve your request before you can listen.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Username'), 'maria');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'longenough1');
    await fireEvent.changeText(screen.getByLabelText('Confirm password'), 'different-one');
    await fireEvent.press(screen.getByText('Send my request'));
    await rerender(view(controller));
    expect(screen.getByText('The two passwords are not the same.')).toBeTruthy();
    expect(register).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByLabelText('Confirm password'), 'longenough1');
    await fireEvent.press(screen.getByText('Send my request'));
    expect(register).toHaveBeenCalledWith('maria', 'longenough1');
    expect(controller.getState()).toEqual({ name: 'pending', username: 'maria' });
  });

  it('tells a registrant that the username is taken', async () => {
    const controller = await started({
      register: async () => {
        throw new AuthFlowError('username_taken');
      },
    });
    controller.setMode('register');
    const { rerender } = await render(view(controller));
    await fireEvent.changeText(screen.getByLabelText('Username'), 'maria');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'longenough1');
    await fireEvent.changeText(screen.getByLabelText('Confirm password'), 'longenough1');
    await fireEvent.press(screen.getByText('Send my request'));
    await rerender(view(controller));
    expect(screen.getByText('That username is taken. Pick another one.')).toBeTruthy();
  });
});

describe('Waiting for approval', () => {
  it('shows the waiting screen with a way to check again and to sign out', async () => {
    const onCheck = jest.fn(async () => {});
    const onSignOut = jest.fn();
    await render(<PendingScreen username="maria" onCheck={onCheck} onSignOut={onSignOut} />);
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    await fireEvent.press(screen.getByText('Check again'));
    expect(onCheck).toHaveBeenCalled();
    await fireEvent.press(screen.getByText('Sign out'));
    expect(onSignOut).toHaveBeenCalled();
  });
});

describe('Shell', () => {
  it('keeps the Browse search when coming back from a book', async () => {
    await render(<Shell username="abc" library={fixtureLibrary()} profileApi={{ get: async () => null }} onSignOut={jest.fn()} />);
    await fireEvent.press(screen.getByLabelText('Browse'));
    await fireEvent.changeText(await screen.findByLabelText('Search books'), 'orchard');
    await fireEvent.press(await screen.findByText('The Quiet Orchard'));
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(screen.getByLabelText('Search books').props.value).toBe('orchard');
  });
});
