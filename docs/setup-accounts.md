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

## 2. Cloudflare R2
1. Create or open a Cloudflare account; R2 → enable (it may ask for a payment card, see unknowns).
2. Create buckets `hearthread-prod` and `hearthread-dev`, private (no public access, no custom domain).
3. R2 → Manage API tokens → create **two** tokens:
   - read + write on both buckets (Mac only): `R2_WRITE_KEY_ID`, `R2_WRITE_SECRET`
   - **read only**, Object Read on `hearthread-prod` only (Supabase function secret): `R2_READ_KEY_ID`, `R2_READ_SECRET`
4. Copy the account id: `R2_ACCOUNT_ID`.

## 3. Telegram backup chat
1. Create a **new private chat/group** only for Hearthread; add the existing bot (same bot token as before)
   and make it admin so it can post files.
2. Get the chat id (message the chat, then `getUpdates` on the bot, or use a helper bot).
3. Values: `TELEGRAM_BOT_TOKEN` (already on the Mac), `TELEGRAM_BACKUP_CHAT_ID`.
   Optional second bot if you do not want one token able to post to both chats.

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
| 3 | R2 free allowance | **Verified from docs** | Cloudflare R2 pricing: 10 GB-month storage, 1 M Class A and 10 M Class B ops/month, egress free (Standard storage only). |
| 4 | Does R2 need a payment card | **Mostly verified, confirm live** | Docs are silent; Cloudflare community threads and third-party guides report a card/PayPal is required to enable R2 even for the free tier, with no charge inside the allowance. Only the live signup settles it. |
| 5 | Free slots on the second Supabase account | **Needs the live account** | The CLI login here only sees the first account. Check the dashboard before creating the project. |
| 6 | Stranger sign-up | **Verified on the local stack** (`scripts/auth-smoke.sh`); confirm once on the hosted project | With sign-ups disabled the public sign-up endpoint returns `error_code: "signup_disabled"`. Accounts only come from the `accounts` function. |
| 8 | Free project inactivity pause period | **Needs the live account / dashboard** | Not stated on the pages read. The 3-day keep-alive is designed to be well inside any plausible window. |
