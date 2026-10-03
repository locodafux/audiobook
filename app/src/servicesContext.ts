import { createContext, useContext } from 'react';

import type { BookmarksStore } from './bookmarks/bookmarks';
import type { DownloadQueue } from './downloads/queue';
import type { DownloadStore } from './downloads/store';
import type { PlayerController } from './player/controller';
import type { PositionStore } from './player/position';
import type { SettingsStore } from './settings/settings';
import type { PhonePorts } from './storage/ports';

/** Everything the player and download screens use. Built once per signed-in session. */
export type Services = {
  settings: SettingsStore;
  bookmarks: BookmarksStore;
  positions: PositionStore;
  downloaded: DownloadStore;
  queue: DownloadQueue;
  player: PlayerController;
  /** The Downloads and storage screens' view of the queue and files. */
  ports: PhonePorts;
};

const ServicesContext = createContext<Services | null>(null);
export const ServicesProvider = ServicesContext.Provider;
/** Null in tests that render a screen without the player and downloads. */
export const useServices = (): Services | null => useContext(ServicesContext);
