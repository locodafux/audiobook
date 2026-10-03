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
