# Decisions

Condensed from the approved plans (backend/generator technical plan, wireframes round 2,
rework research). Approved by the captain on 2026-10-02 ("looks good").

## Product
- **Name:** Hearthread. Android package `com.locodafux.hearthread`. It installs next to the
  old app; the old app, its database and its Telegram audio are never touched.
- Android only, English only (voice `en-US-BrianNeural`), one voice per book, chapters are
  the unit of everything. About 5 users, invite-only.
- **Normal speed:** generator rate is `+0%` (the old generator used `-5%`).
- **Fresh library:** books are regenerated through the new generator; old audio is not migrated.
- No admin web page; the CLI is the admin. The Mac does all generating; phones never do.

## Architecture
- Audio and timing files and covers: private **Cloudflare R2** (`hearthread-prod`, `hearthread-dev`).
  Phones download straight from R2 through 15-minute presigned links.
- Catalog and access: **Supabase** Postgres, four tables: `members`, `books`, `chapters`, `jobs`.
  No views; safe columns are exposed with column-level grants. Sentence text is not in the
  database (it is in the timing file in R2).
- One Edge Function, `download-links`, checks the person is still an active member and signs
  R2 links. It never carries audio.
- Telegram is a cold backup only (private chat, same bot). The app and generator never read it back.
- The generator queue is the Postgres `jobs` table (claim with `FOR UPDATE SKIP LOCKED`).
  Order per chapter: upload audio, then timings, verify, mark `ready`, then Telegram, then wipe temp.
- Chapter numbers are 1-based and never renumbered once published (numbering guard + `--accept-renumber`).
- No views, no always-on server, no persistent sentence cache.

## Sign-in
- Invite-only, no passwords: email link plus 6-digit code, PKCE, OTP expiry 900 s.
- Sign-ups disabled in Supabase Auth, so invite-only is enforced by the server, not the app.
- Custom SMTP (Gmail app password): Supabase's built-in sender only reaches project team
  members at 2 emails/hour.
- Revoke = `members.status = 'revoked'` plus an auth ban; downloaded files stay on the phone, locked.
- Redirect URL: `hearthread://auth`.

## Database access rules
| Who | members | books | chapters | jobs |
|---|---|---|---|---|
| Stranger | nothing | nothing | nothing | nothing |
| Signed in, revoked | own row | nothing | nothing | nothing |
| Active member | own row | published books, safe columns | ready chapters of published books, safe columns | nothing |
| Generator (service role) | read/write | read/write | read/write | read/write |

## Repo, tooling, CI
- One public repo `locodafux/audiobook`: `app/`, `generator/`, `supabase/`, `scripts/`, `docs/`.
- uv + ruff + pytest (generator); TypeScript + eslint + jest (app); deno test (function);
  `supabase db reset` + `supabase test db` (database); gitleaks as pre-commit hook and in CI.
- Secrets: Mac-only `.env.dev` / `.env.prod`; R2 read key as function secret; app holds only
  the Supabase URL and anon key. No key from the old Supabase project is reused.
- Release: signed arm64 APK built locally, uploaded to a rolling GitHub release `latest`; the
  app checks it and shows an update banner. Keep-alive: GitHub workflow pings `ping()` every 3 days.
- Public repo hygiene: no book text or audio ever committed; site-specific watermark rules live
  in a git-ignored local rules file.

## App design (wireframes round 2, "Dusk")
- Dark-first, jade accent (indigo, amber, rose alternatives), Manrope + Fraunces, generated
  gradient covers as fallback; real cover extracted from the EPUB by the generator.
- Tabs: Home, Browse, Downloads, You. Floating mini-player.
- v1 scope: default speed with per-book override, skip back 15 s / forward 30 s, richer sleep
  timer, smart rewind, keep-next-N downloads (Wi-Fi only on by default), auto-clean + storage
  view, bookmark notes, listening stats, series grouping + chapter search, reading-view
  controls, theme and accent, in-app updates.
- Bookmarks, stats, settings and positions are phone-only in v1.
- When access ends or on sign-out: keep downloaded files, app locked until sign-in.
- Invite-only message: explicit "not on the invite list".
- Swipe-left row actions on storage, queue and bookmark rows.

## Build order
0 accounts and empty home, 1 tables/rules/invites, 2 generator (one book, dev), 3 link function
and Telegram backup, 4 app shell (sign-in, library), 5 download and offline player, 6 remaining
screens, 7 release and keep-alive, 8 real library and friends.
