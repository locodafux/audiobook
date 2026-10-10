import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, type ComponentType } from 'react';

import { loadAppearance } from './settings/appearance';

/**
 * The registered root. The saved theme and accent are applied first so the very first frame already has
 * the right colours; after that `useAppearance` keeps them current.
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
