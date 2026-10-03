# Hearthread

A small, invite-only audiobook app for friends and family.

**In plain English.** A Mac turns an EPUB into one audio file per chapter and stores them
in a private Cloudflare R2 bucket (with a cold backup in a private Telegram chat). A tiny
Supabase database lists the books and chapters and says who is invited. Friends sign in
with an emailed link or 6-digit code, download chapters straight from R2 through
short-lived links, and listen offline in an Android app.

This repo is public. It contains code and rules only: no books, no audio, no keys.

## Layout

| Path | What |
|---|---|
| `app/` | Android app (Expo / React Native, TypeScript) |
| `generator/` | the `hearthread` CLI (Python, uv) |
| `supabase/` | migrations, pgTAP rule tests, `config.toml`, email template, link function |
| `scripts/` | release and keep-alive helpers |
| `docs/` | plan decisions, behaviour spec, account setup steps |
| `.github/workflows/` | CI, secret scan |

## Docs

- [docs/decisions.md](docs/decisions.md): what was decided and why
- [docs/setup-accounts.md](docs/setup-accounts.md): the by-hand steps (Supabase, R2, Telegram, SMTP)
- [docs/SPEC.md](docs/SPEC.md): behaviour of the previous app, which Hearthread re-implements from scratch

## Local database

Needs Docker-compatible runtime (Colima on macOS) and the Supabase CLI.

```sh
colima start
supabase start
supabase db reset     # applies supabase/migrations from scratch
supabase test db      # runs supabase/tests (pgTAP)
```

## Secrets

Real values live only in git-ignored `.env.dev` / `.env.prod` on the Mac and in Supabase
function secrets. Only `.env.example` files (names, no values) are committed.
Install the hook once: `pre-commit install` (runs gitleaks on every commit). CI scans the
whole history.
