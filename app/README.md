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
