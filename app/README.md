# Hearthread app

Android app (Expo SDK 57, TypeScript). Package `com.locodafux.hearthread`, deep-link scheme `hearthread` (sign-in redirect `hearthread://auth`).

```
cp .env.example .env      # set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (public values only)
npm ci
npm run android           # dev build on a connected device or emulator
npm run typecheck && npm run lint && npm test && npm run bundle
```

Screens read the catalog through `LibraryApi` (`src/data/library.ts`) and sign in through `AuthApi` (`src/auth/authApi.ts`); tests use fixtures and fakes, so none of them need a server.
Offline: the book list is saved on the phone after every successful load and shown (with an "Offline" pill) when the server cannot be reached.

Phone-only data (plan section 3) lives in three small stores created by `createPhone` (`src/phone/PhoneProvider.tsx`) and read anywhere with `usePhone()`:
settings (`src/settings`, includes `speedFor(settings, bookId)` and `smartRewindS`), bookmarks (`src/bookmarks`) and listening stats (`src/stats`; the player calls `stats.record(bookId, secondsPlayed)`).
The Downloads and storage screens talk to the download/storage worker through the interfaces in `src/storage/ports.ts` (`Shell` takes `ports`; `stubPorts` shows empty states until they are wired).
Theme and accent are applied once at startup (`src/Root.tsx`), so changing them takes effect the next time the app opens.

## Player and downloads

Chapters are played from files on the phone (private app storage, `hearthread/books/<book>/ch-0001.mp3` plus `.json` timing). Native pieces sit behind small interfaces (`PlayerEngine`, `FileStore`, `NetworkWatcher`) so the queue, storage, position saving, smart rewind, sleep timer and timing lookup are tested with in-memory fakes. The real expo-audio / expo-file-system / expo-network adapters are only imported from `src/services.ts`, which also builds the `PhonePorts` the Downloads screen uses (`src/storage/phonePorts.ts`).

- Downloads: one at a time, Wi-Fi only by default (Settings), keep-next-N after the chapter you are on, 3 tries then a manual Retry, size and SHA-256 checked before a chapter is kept. Links come from the `download-links` function in batches of up to 10, just before they are used. The request/response shape is in `src/downloads/links.ts` (the one place to change if the function differs).
- Playback: background audio with the notification and lock-screen card. Notification skip buttons use the platform step (expo-audio cannot set 15/30 s there). Shake-to-extend the sleep timer is not included.
- The player reads the phase 6 settings (speed and per-book speed, skip, smart rewind, Play next chapter, keep-next, auto-clean days, text size, follow), saves bookmarks and reports listening time and finished books to the stats store. Positions and downloads are stored on the phone only.
