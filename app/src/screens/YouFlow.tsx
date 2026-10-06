import { useEffect, useState } from 'react';
import { BackHandler } from 'react-native';

import type { AdminApi } from '../admin/adminApi';
import type { BookRow } from '../data/types';
import { usePhone } from '../phone/PhoneProvider';
import type { Profile } from '../profile/profile';
import type { StoragePort } from '../storage/ports';
import { AdminScreen } from './AdminScreen';
import { StatsScreen } from './StatsScreen';
import { AppearanceSettings, DownloadsSettings, PlaybackSettings } from './SettingsScreens';
import { YouScreen, type YouRoute } from './YouScreen';

/** The You tab and the pages under it; the hardware Back button steps out one page. */
export function YouFlow({
  username,
  profile,
  adminApi,
  books,
  storage,
  onSignOut,
}: {
  username: string;
  profile: Profile | null;
  /** Offered to admins (profile.isAdmin) as the Requests page. */
  adminApi?: AdminApi;
  books: readonly BookRow[];
  storage: StoragePort;
  onSignOut: () => void;
}) {
  const [route, setRoute] = useState<YouRoute | null>(null);
  const { bookmarks } = usePhone();

  useEffect(() => {
    if (!route) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => (setRoute(null), true));
    return () => sub.remove();
  }, [route]);

  const back = () => setRoute(null);
  switch (route) {
    case 'stats':
      return <StatsScreen books={books} onBack={back} />;
    case 'playback':
      return <PlaybackSettings onBack={back} />;
    case 'downloads':
      return <DownloadsSettings storage={storage} onClearAll={bookmarks.clear} onBack={back} />;
    case 'appearance':
      return <AppearanceSettings onBack={back} />;
    case 'admin':
      return adminApi ? <AdminScreen api={adminApi} onBack={back} /> : null;
    default:
      return <YouScreen username={username} profile={profile} onSignOut={onSignOut} onOpen={setRoute} />;
  }
}
