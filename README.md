# Hearthread

A small, invite-only audiobook app for friends and family.

**In plain English.** A Mac turns an EPUB into one audio file per chapter and stores them
in a private Cloudflare R2 bucket (with a cold backup in a private Telegram chat). A tiny
Supabase database lists the books and chapters and says who is approved. Friends ask to join
with a username and password, the admin approves them in the app, then they download chapters straight from R2 through
short-lived links, and listen offline in an Android app.

This repo is public. It contains code and rules only: no books, no audio, no keys.

## What is built

- **Android app** (`app/`): username and password sign-in (new accounts wait for approval; the admin approves, rejects and resets passwords in a Requests screen), Home, Browse (search by
  title, author or series), book page, Downloads and storage, You (stats, bookmarks and notes,
  settings). Chapters download in the background (Wi-Fi only by default, size and SHA-256
  checked) and play offline with lock-screen controls, read-along text, sleep timer, smart
  rewind and per-book speed. The book list still shows when offline. An update banner offers
  a newer APK from the GitHub release `latest`.
- **Generator** (`generator/`): the `hearthread` CLI on the Mac. It reads an EPUB, queues
  chapters, voices them (edge-tts), uploads to R2, backs up to Telegram, and publishes books.
  It also has an older email-invite admin tool (`invite add | revoke | list`); sign-in no longer
  uses email, so approving people in the app is the way now.
- **Database** (`supabase/migrations/`): four tables (`members`, `books`, `chapters`, `jobs`)
  with row-level rules: strangers see nothing, revoked members only their own row, active
  members only published books and ready chapters.
- **Accounts function** (`supabase/functions/accounts/`): the only way an account is created. It
  registers a pending member (synthetic internal email, never shown) and lets the admin approve,
  reject and reset passwords. Public Supabase sign-ups stay off.
- **Link function** (`supabase/functions/download-links/`): checks the person is still approved
  and returns 15-minute presigned R2 links. It never carries audio.
- **Release and keep-alive** (`scripts/`): `release.sh` builds and publishes the signed APK;
  a GitHub workflow runs `keepalive.sh` every 3 days so the free Supabase project never idles.

Not done yet: the live accounts (Supabase project, R2, Telegram chat, email sender), the real
library and inviting friends. Every part is built and tested locally only.

## Layout

| Path | What | Tech |
|---|---|---|
| `app/` | Android app ([app/README.md](app/README.md)) | Expo SDK 57, React Native, TypeScript, jest |
| `generator/` | the `hearthread` CLI ([generator/README.md](generator/README.md)) | Python 3.12, uv, ruff, pytest, ffmpeg |
| `supabase/` | migrations, pgTAP rule tests, `config.toml`, link and accounts functions | Postgres, Supabase CLI, Deno |
| `scripts/` | `release.sh`, `keepalive.sh`, `auth-smoke.sh`, `set-admin-login.sh` and their test | bash |
| `docs/` | decisions, account setup, signing-key backup, spec of the previous app | |
| `.github/workflows/` | CI (generator, app, scripts, database, link function), secret scan, keep-alive | |

## Docs

- [docs/decisions.md](docs/decisions.md): what was decided and why
- [docs/setup-accounts.md](docs/setup-accounts.md): the by-hand account steps (Supabase, R2, Telegram)
- [docs/signing-key-backup.md](docs/signing-key-backup.md): create and back up the APK signing key
- [docs/SPEC.md](docs/SPEC.md): behaviour of the previous app, which Hearthread re-implements from scratch

## Run it locally

Everything below runs on your machine against a local throw-away database and fakes; nothing
touches the live services.

**Local database.** Needs a Docker-compatible runtime (Colima on macOS) and the Supabase CLI.

```sh
colima start
supabase start
supabase db reset     # applies supabase/migrations from scratch
supabase test db      # runs supabase/tests (pgTAP)
scripts/auth-smoke.sh # local sign-in check: sign-up closed, pending sees nothing, approved sees books
```

**App.**

```sh
cd app
cp .env.example .env      # EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (public values only)
npm ci
npm run android           # dev build on a connected device or emulator
npm run typecheck && npm run lint && npm test && npm run bundle
```

**Generator.**

```sh
cd generator
uv sync
cp .env.example .env.dev  # never commit it; .env.prod is only used with --prod
uv run hearthread doctor  # dev by default
uv run hearthread --help  # add, run, status, publish, invite, ...
uv run ruff check . && uv run pytest
```

Generator tests use fakes for voice, R2, Telegram and the EPUB parser. Queue, pipeline and
invite tests need the local database (`supabase start`, `supabase db reset`) and skip without it;
they empty its tables, so only point them at a throw-away database.

**Link function.** Needs Deno 2.

```sh
cd supabase/functions/download-links
deno fmt --check && deno lint && deno test
```

**Release and keep-alive scripts.** `scripts/release.test.sh` checks both without building,
publishing or using the network.

## Making a release

1. Bump `expo.android.versionCode` in `app/app.json` (the app only offers an APK newer than itself).
2. Put the keystore path, passwords, alias and the public Supabase URL and anon key in the
   git-ignored `.env.release` (the variable names are in the header of `scripts/release.sh`).
   The keystore must live outside the repo; see [docs/signing-key-backup.md](docs/signing-key-backup.md).
3. `scripts/release.sh --dry-run` checks the config and prints the plan.
4. `scripts/release.sh` builds the signed arm64 APK and uploads it as `hearthread-<versionCode>.apk`,
   the only asset of the rolling GitHub release `latest`. Installed apps then show the update banner.

## What still needs your accounts

The live Supabase project, R2 buckets and keys, Telegram backup chat and the Auth settings are set up by hand: follow [docs/setup-accounts.md](docs/setup-accounts.md).
The keep-alive workflow does nothing until the `SUPABASE_URL` and `SUPABASE_ANON_KEY` repository
secrets or variables are set.

## Secrets

Real values live only in git-ignored `.env.dev` / `.env.prod` / `.env.release` on the Mac and in
Supabase function secrets. Only `.env.example` files (names, no values) are committed.
Install the hook once: `pre-commit install` (runs gitleaks on every commit). CI scans the
whole history.
