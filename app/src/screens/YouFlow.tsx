import { useEffect, useState } from 'react';
import { BackHandler } from 'react-native';

import type { BookRow } from '../data/types';
import { usePhone } from '../phone/PhoneProvider';
import type { Profile } from '../profile/profile';
import type { StoragePort } from '../storage/ports';
import { StatsScreen } from './StatsScreen';
import { AppearanceSettings, DownloadsSettings, PlaybackSettings } from './SettingsScreens';
import { YouScreen, type YouRoute } from './YouScreen';

/** The You tab and the pages under it; the hardware Back button steps out one page. */
export function YouFlow({
  email,
  profile,
  books,
  storage,
  onSignOut,
}: {
  email: string;
  profile: Profile | null;
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
    default:
      return <YouScreen email={email} profile={profile} onSignOut={onSignOut} onOpen={setRoute} />;
  }
}
