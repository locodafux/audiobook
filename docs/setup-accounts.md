# Account setup: what you do by hand

Nothing here can be done by the CLI or CI. Do the steps in order; each ends with the value
to put in a git-ignored `.env.dev` / `.env.prod` on the Mac (never in the repo, never in chat).

## 1. Supabase project (second account)
1. Sign in to the Supabase account that has a free project slot (the first account's organisation
   already holds 2 projects, the free limit).
2. New project: name `hearthread`, region **Singapore** (cannot be changed later), strong DB password
   (save it in your password manager).
3. Settings → API: copy **Project URL**, **anon key**, **service_role key**.
4. Settings → Database → Connection string → **Session pooler** (port 5432, not 6543): copy as `SUPABASE_DB_URL`.
5. Authentication → Sign In / Providers: keep the **Email** provider ON and **"Allow new users to sign up" OFF**. Email confirmation can stay on: the `accounts` function creates users already confirmed, so no mail is ever sent.
6. Link and push later from this repo: `supabase link --project-ref <ref>` then `supabase db push`
   (phase 1 PR; do not push until the pgTAP tests are green).

Values: `SUPABASE_URL`, `SUPABASE_ANON_KEY` (app), `SUPABASE_SERVICE_KEY`, `SUPABASE_DB_URL` (Mac only).

## 2. Audio storage: Telegram (no Cloudflare)
Audio lives in Telegram and is served through a small proxy on Deno Deploy, so **no Cloudflare
account is needed**. The old app's bot and private chat are reused: no new bot or chat.
1. On the Mac, put the existing bot's values in `.env.dev` / `.env.prod`: `TELEGRAM_BOT_TOKEN` and
   `TELEGRAM_BACKUP_CHAT_ID` (the old project's `TELEGRAM_CHAT_ID`; the generator uses the same chat for
   new uploads). Check the bot is still admin of that chat.
2. Choose where the Mac keeps its own copy of every chapter (`HEARTHREAD_LIBRARY_DIR`, optional). This
   folder is the real backup: Telegram may delete files. Keep it on a disk that is backed up.
3. Chapters must stay under 20 MB (the most a bot can download again). The generator refuses larger ones.

## 3. Deno Deploy (the audio proxy)
Needs: a free Deno Deploy account, and either a login on the Mac or a token.
1. Sign up at <https://console.deno.com> (free plan, about 20 GiB of outgoing data a month; confirm
   the current figure on the plan page) and create an organisation.
2. Deploy from this repo's `audio-proxy/` folder with the Deno CLI (v2.4 or newer): `deno deploy create`
   (interactive: pick the organisation, name the app `hearthread-audio`, entrypoint `main.ts`).
   First time it opens a browser to log in. For a non-interactive deploy, create an organisation token
   in the dashboard and export it as `DENO_DEPLOY_TOKEN`; it never goes in the repo.
3. Set the three secrets, marked secret, **only in Deno Deploy** (values never in the repo, the app or chat):
   `deno deploy env add TELEGRAM_BOT_TOKEN <value> --secret`, same for `SUPABASE_URL` and
   `SUPABASE_SERVICE_ROLE_KEY` (the Supabase values from section 1, step 3). Then redeploy.
4. Put the app's public address in the app's git-ignored `.env` as `EXPO_PUBLIC_AUDIO_PROXY_URL`
   (the `https://....deno.dev` URL, no secret in it) and in `.env.release` for release builds.
5. Sanity check without audio: `curl -i https://<proxy>/audio/x/1` must answer `401`.

## First-release checklist (in order)
1. Section 1 (Supabase) and `supabase db push` (includes the private-books migration).
2. Section 2 (Telegram values on the Mac) and `hearthread --prod doctor`.
3. Section 3 (Deno Deploy proxy) and the app's `EXPO_PUBLIC_AUDIO_PROXY_URL`.
4. Invite yourself: `hearthread --prod invite add you@mail.com`, sign in once in the app.
5. Import the Shadow Slave volumes, private to you (see `generator/README.md`, "Importing audio the
   previous app already voiced"): one `hearthread --prod import-voiced ... --private-to you@mail.com`
   per volume, `--limit 3` first as a trial. About 2,300 chapters take roughly 4 hours of unattended
   running in total because Telegram limits how fast a bot may send.
6. Email sender (section 4) and a release (`scripts/release.sh`).

## 4. Accounts function and the first admin
Sign-in is a username and password; there is no email step and no SMTP sender to set up.
1. Deploy the function: `supabase functions deploy accounts --project-ref <ref>`
   (it uses the `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` Supabase gives every function; nothing to add).
2. Apply the migrations (`supabase db push`): the one named `username_login` makes your existing
   member (`leonardotimkangjr@gmail.com`) the admin with username `leo`.
3. Give that account its password once: `scripts/set-admin-login.sh` (asks for the project URL, the
   service-role key and the new password; nothing is saved).
4. Install the new app, log in as `leo`, and open You → Requests.

## Phase-0 unknowns

| # | Unknown | Status | Evidence |
|---|---|---|---|
| 1 | Built-in email sender limits | **No longer matters** | Sign-in sends no email. |
| 2 | Free plan numbers | **Verified from docs** (inactivity days not stated on the page I read) | Supabase billing docs: 2 free projects per organisation (paused ones don't count), 500 MB database, 5 GB egress/month. |
| 3 | Telegram as the audio store | **Verified from docs and the earlier investigation** | A bot uploads up to 50 MB but can only download up to 20 MB with `getFile`; the proxy serves chapters that stay under 20 MB. Telegram may delete files, so the Mac's library folder is the real backup. |
| 4 | Deno Deploy free plan allowance | **Needs the live account** | About 20 GiB outgoing a month was the working figure; the plan page on the live account settles it. |
| 5 | Free slots on the second Supabase account | **Needs the live account** | The CLI login here only sees the first account. Check the dashboard before creating the project. |
| 6 | Stranger sign-up | **Verified on the local stack** (`scripts/auth-smoke.sh`); confirm once on the hosted project | With sign-ups disabled the public sign-up endpoint returns `error_code: "signup_disabled"`. Accounts only come from the `accounts` function. |
| 8 | Free project inactivity pause period | **Needs the live account / dashboard** | Not stated on the pages read. The 3-day keep-alive is designed to be well inside any plausible window. |
