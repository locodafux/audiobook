# Decisions

Condensed from the approved plans (backend/generator technical plan, wireframes round 2,
rework research). Approved by the captain on 2026-10-02 ("looks good").

## Product
- **Name:** Hearthread. Android package `com.locodafux.hearthread`. It installs next to the
  old app; the old app, its database and its Telegram audio are never touched.
- Android only, English only (voice `en-US-BrianNeural`), one voice per book, chapters are
  the unit of everything. About 5 users, invite-only.
- **Normal speed:** generator rate is `+0%` (the old generator used `-5%`).
- **Library:** new books go through the new generator. The audio the previous app already voiced
  (Shadow Slave) is imported once with `hearthread import-voiced`, private to the owner.
- No admin web page; the CLI is the admin. The Mac does all generating; phones never do.

## Architecture
- Audio and timing files: stored in **Telegram** (the old app's bot and a private chat). The Mac also keeps
  every file in a local library folder, which is the real backup (Telegram may delete files). No
  Cloudflare account is needed. Covers: not served yet (the app draws its gradient).
- Catalog and access: **Supabase** Postgres, four tables: `members`, `books`, `chapters`, `jobs`.
  No views; safe columns are exposed with column-level grants. Sentence text is not in the
  database (it is in the timing file).
- One small proxy, `audio-proxy/`, on **Deno Deploy** (free, about 20 GiB/month out). The phone sends its
  sign-in token; the proxy asks Supabase Auth who it is, checks `members.status = 'active'` (and
  the book's `private_to`), asks Telegram `getFile`, and streams the bytes with Range support. The bot
  token lives only there (and on the Mac). It runs on Deno Deploy rather than a Supabase Edge Function
  because the free Supabase plan's 5 GB/month egress cannot carry a ~6.5 GB book. Telegram bots can
  download files up to 20 MB, so a chapter over 20 MB is refused at upload time.
- `books.private_to` makes a book visible to one member only (the previous app's audio is imported
  that way, for the owner).
- The generator queue is the Postgres `jobs` table (claim with `FOR UPDATE SKIP LOCKED`).
  Order per chapter: copy audio and timings to the library folder, upload both to Telegram (a hard gate),
  record the `file_id`s and mark `ready`, then wipe temp.
- Chapter numbers are 1-based and never renumbered once published (numbering guard + `--accept-renumber`).
- No views, no always-on server, no persistent sentence cache.

## Sign-in
- Username and password. No email, magic link or code anywhere (this replaced the earlier email link and 6-digit code).
- A new account is `pending` and sees nothing (every database rule and the link function require `active`) until the admin approves it in the app.
- The `accounts` function creates accounts (service role, synthetic internal email `<username>@users.hearthread.invalid`, pre-confirmed), so public sign-ups stay disabled and no mail is sent. Login itself goes straight to Supabase Auth, so its per-IP rate limit protects it.
- Admin (`members.is_admin`, checked on the server): approve, reject and reset a member's password. No email reset exists; a forgotten password is fixed by the admin.
- Reject or revoke = `members.status = 'revoked'`; downloaded files stay on the phone, locked.
- The session stays stored on the phone, so the app still opens offline.

## Database access rules
| Who | members | books | chapters | jobs |
|---|---|---|---|---|
| Stranger | nothing | nothing | nothing | nothing |
| Signed in, revoked | own row | nothing | nothing | nothing |
| Active member | own row | published books, safe columns | ready chapters of published books, safe columns | nothing |
| Generator (service role) | read/write | read/write | read/write | read/write |

## Repo, tooling, CI
- One public repo `locodafux/audiobook`: `app/`, `generator/`, `supabase/`, `scripts/`, `docs/`.
- uv + ruff + pytest (generator); TypeScript + eslint + jest (app); deno test (audio proxy);
  `supabase db reset` + `supabase test db` (database); gitleaks as pre-commit hook and in CI.
- Secrets: Mac-only `.env.dev` / `.env.prod`; the proxy's `TELEGRAM_BOT_TOKEN`, `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` are Deno Deploy secrets; app holds only the Supabase URL, anon key and the
  public proxy URL. No key from the old Supabase project is reused.
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
- Pending message: "Waiting for approval"; rejected: "not approved".
- Swipe-left row actions on storage, queue and bookmark rows.

## Build order
0 accounts and empty home, 1 tables/rules/invites, 2 generator (one book, dev), 3 audio proxy
and Telegram store, 4 app shell (sign-in, library), 5 download and offline player, 6 remaining
screens, 7 release and keep-alive, 8 real library and friends.
