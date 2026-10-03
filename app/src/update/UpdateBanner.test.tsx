import { fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

import { UpdateBanner } from './UpdateBanner';

jest.mock('@expo/vector-icons', () => ({ Feather: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));

describe('UpdateBanner', () => {
  it('shows nothing when up to date', async () => {
    await render(<UpdateBanner check={async () => null} />);
    expect(screen.queryByText(/Update available/)).toBeNull();
  });
  it('opens the APK and can be dismissed', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await render(<UpdateBanner check={async () => ({ versionCode: 2, url: 'https://x/hearthread-2.apk' })} />);
    await fireEvent.press(await screen.findByText(/Update available/));
    expect(open).toHaveBeenCalledWith('https://x/hearthread-2.apk');
    await fireEvent.press(screen.getByLabelText('Dismiss'));
    expect(screen.queryByText(/Update available/)).toBeNull();
  });
});
