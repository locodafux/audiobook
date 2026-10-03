import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import type { FileStore } from './files';

const toHex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Chapter files live in the app's private documents folder under `hearthread/`. */
export function createExpoFiles(): FileStore {
  const root = new Directory(Paths.document, 'hearthread');
  const file = (path: string) => new File(root, path);
  const ensureParent = (f: File) => f.parentDirectory.create({ intermediates: true, idempotent: true });

  return {
    exists: (path) => file(path).exists,
    size: (path) => {
      const f = file(path);
      return f.exists ? f.size : null;
    },
    readText: (path) => file(path).text(),
    writeText(path, text) {
      const f = file(path);
      ensureParent(f);
      f.create({ overwrite: true });
      f.write(text);
    },
    async download(url, path, { onProgress, signal }) {
      const f = file(path);
      ensureParent(f);
      await File.downloadFileAsync(url, f, { idempotent: true, signal, onProgress: onProgress && (({ bytesWritten, totalBytes }) => onProgress(bytesWritten, totalBytes)) });
    },
    // ponytail: reads the whole chapter (about 3 MB, rarely 30 MB) into memory to hash it; chunked hashing if that ever hurts.
    async sha256(path) {
      return toHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file(path).bytes()));
    },
    move(from, to) {
      const dest = file(to);
      ensureParent(dest);
      file(from).move(dest, { overwrite: true });
    },
    remove(path) {
      const f = file(path);
      if (f.exists) f.delete();
    },
    removeDir(path) {
      const d = new Directory(root, path);
      if (d.exists) d.delete();
    },
    uri: (path) => file(path).uri,
    freeBytes: () => Paths.availableDiskSpace,
  };
}
