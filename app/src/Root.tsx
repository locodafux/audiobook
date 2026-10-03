import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, type ComponentType } from 'react';

import { loadAppearance } from './settings/appearance';

/**
 * The registered root. Screens build their styles from `colors` when their module loads, so the saved
 * theme and accent are applied first and the app (and with it every screen module) is imported after.
 */
export default function Root() {
  const [App, setApp] = useState<ComponentType | null>(null);
  useEffect(() => {
    void loadAppearance(AsyncStorage)
      .then(() => import('./App'))
      .then((m) => setApp(() => m.default));
  }, []);
  return App ? <App /> : null;
}
