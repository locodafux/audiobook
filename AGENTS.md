# Hearthread

Invite-only audiobook app: `app/` (Expo), `generator/` (Python CLI, uv), `supabase/` (SQL, pgTAP, config).
Read `docs/decisions.md` first; account setup is in `docs/setup-accounts.md`.

- Public repo: never commit `.env*`, keystores, APKs, audio, EPUBs. Run `gitleaks protect --staged` before committing.
- Database changes: new numbered file in `supabase/migrations/`, plus a pgTAP test in `supabase/tests/`. Check with `supabase db reset && supabase test db`.
- Never write to a live Supabase project, Telegram chat or MongoDB from tests; tests use the local database only.
- The previous app and its backend are read-only reference.
