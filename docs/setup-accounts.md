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
5. Authentication → URL Configuration: add redirect URL `hearthread://auth`.
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

## 4. Email sender (Gmail SMTP)
1. Use a Google account with 2-step verification on.
2. Google Account → Security → App passwords → create one named `hearthread`.
3. Supabase dashboard → Authentication → SMTP: host `smtp.gmail.com`, port `465`, user = the Gmail
   address, password = the app password, sender = the same address, name `Hearthread`.
   (Local dev reads these from `SUPABASE_SMTP_USER` / `SUPABASE_SMTP_PASS` / `SUPABASE_SMTP_FROM`; names only here.)
4. Authentication → Rate limits: raise "emails per hour" above the 30 that custom SMTP starts with if needed.
5. Authentication → Sign In / Providers: keep the **Email** provider enabled but turn **"Allow new users to sign up" off** (this is what makes sign-in invite-only; turning the Email provider itself off breaks all email login); paste the template from
   `supabase/email-template.html` into the Magic Link template (config.toml does this for local only).

## 5. Redirect URL
`hearthread://auth` must be in Authentication → URL Configuration → Redirect URLs (step 1.5).

## Phase-0 unknowns

| # | Unknown | Status | Evidence |
|---|---|---|---|
| 1 | Built-in email sender limits | **Verified from docs** | Supabase "auth-smtp" docs: built-in sender only sends to project team members, 2 messages/hour. Custom SMTP starts at 30/hour (adjustable). So Gmail SMTP is required before any friend can sign in. |
| 2 | Free plan numbers | **Verified from docs** (inactivity days not stated on the page I read) | Supabase billing docs: 2 free projects per organisation (paused ones don't count), 500 MB database, 5 GB egress/month. |
| 3 | R2 free allowance | **Verified from docs** | Cloudflare R2 pricing: 10 GB-month storage, 1 M Class A and 10 M Class B ops/month, egress free (Standard storage only). |
| 4 | Does R2 need a payment card | **Mostly verified, confirm live** | Docs are silent; Cloudflare community threads and third-party guides report a card/PayPal is required to enable R2 even for the free tier, with no charge inside the allowance. Only the live signup settles it. |
| 5 | Free slots on the second Supabase account | **Needs the live account** | The CLI login here only sees the first account. Check the dashboard before creating the project. |
| 6 | Stranger sign-in error code | **Verified on the local stack** (`scripts/auth-smoke.sh`); confirm once on the hosted project | With sign-ups disabled, asking for a code for an uninvited address returns HTTP 422 `error_code: "signup_disabled"` (or `otp_disabled` if the app sends `create_user: false`); no email is sent. The app maps both to "not on the invite list". The hosted project runs the same Auth server, but only a live call settles it. |
| 7 | Gmail app password works for SMTP at friend volume | **Needs the live account** | Provider limits not verified; a mail to your own address in phase 1 confirms delivery. |
| 8 | Free project inactivity pause period | **Needs the live account / dashboard** | Not stated on the pages read. The 3-day keep-alive is designed to be well inside any plausible window. |
