import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';

import { keepNextChapters } from './downloads/autoDownload';
import { cleanUpOld } from './downloads/cleanup';
import { createExpoFiles } from './downloads/expoFiles';
import { createExpoNetwork } from './downloads/expoNetwork';
import { readSavedBookList } from './data/offlineList';
import type { BookRow, ChapterRow } from './data/types';
import { supabaseLinks } from './downloads/links';
import { createDownloadQueue } from './downloads/queue';
import { createDownloadStore } from './downloads/store';
import { createPlayerController } from './player/controller';
import { createExpoEngine } from './player/expoEngine';
import { createPositionStore } from './player/position';
import type { Phone } from './phone/PhoneProvider';
import type { Services } from './servicesContext';
import { createPhonePorts } from './storage/phonePorts';

/** Wires the real phone pieces (audio, files, network) to the queue, the player and the screens' ports. */
export async function createServices(client: SupabaseClient, phone: Phone): Promise<Services> {
  const { settings, bookmarks, stats } = phone;
  const files = createExpoFiles();
  const positions = createPositionStore(AsyncStorage);
  const downloaded = createDownloadStore(AsyncStorage, files);
  const queue = createDownloadQueue({ kv: AsyncStorage, files, links: supabaseLinks(client), downloaded, settings, network: createExpoNetwork() });
  const player = createPlayerController({
    engine: createExpoEngine(),
    files,
    downloaded,
    positions,
    settings,
    onChapter: (book: BookRow, chapters: ChapterRow[], n: number) => void keepNextChapters({ queue, downloaded, settings }, book, chapters, n),
    onListened: stats.record,
    onBookFinished: stats.markFinished,
  });
  await Promise.all([positions.load(), downloaded.load()]);
  downloaded.reconcile();
  cleanUpOld(downloaded, positions, settings.getState().autoCleanDays, Date.now());
  await queue.load();
  const counts = new Map((await readSavedBookList(AsyncStorage))?.books.map((b) => [b.id, b.chapter_count]));
  const ports = createPhonePorts({ downloaded, positions, queue, player, files, totalChapters: (id) => counts.get(id) });
  return { settings, bookmarks, positions, downloaded, queue, player, ports };
}
