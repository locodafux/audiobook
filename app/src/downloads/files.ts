/** The phone's file storage, as the downloads need it. Paths are relative to the app's own folder; tests use an in-memory copy. */
export interface FileStore {
  exists(path: string): boolean;
  /** Size in bytes, or null when the file is missing. */
  size(path: string): number | null;
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): void;
  /** Saves `url` at `path`. Rejects on any HTTP or network failure, and when `signal` aborts. */
  download(url: string, path: string, opts: { onProgress?: (written: number, total: number) => void; signal?: AbortSignal }): Promise<void>;
  /** Lowercase hex SHA-256 of the file. */
  sha256(path: string): Promise<string>;
  move(from: string, to: string): void;
  remove(path: string): void;
  removeDir(path: string): void;
  /** A URI the audio player can open. */
  uri(path: string): string;
  freeBytes(): number;
}
