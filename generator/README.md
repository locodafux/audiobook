# hearthread (generator)

The Mac-side CLI: turns an EPUB into one audio file per chapter, uploads to R2, backs up to Telegram,
and manages invites. Plan: section 6 of the Hearthread technical plan.

```sh
cd generator
uv sync
cp .env.example .env.dev        # fill in; never commit it. .env.prod is only used with --prod
uv run hearthread doctor        # dev by default; prints loudly which environment it is
uv run hearthread add book.epub
uv run hearthread run           # or: run --once
uv run hearthread status
uv run hearthread invite add friend@mail.com --name Friend
```

Everything defaults to **dev**. Real data needs `--prod`.

Tests (`uv run pytest`) use fakes for voice, R2, Telegram and the EPUB parser, so nothing touches the
network. Queue/pipeline/invite tests need the local Supabase database (`supabase start`, then
`supabase db reset`); without it they skip with the reason. They refuse any non-local database host
and **empty the jobs/chapters/books/members tables**, so only point them at a throw-away database
(`TEST_DATABASE_URL`, default `postgresql://postgres:postgres@127.0.0.1:54322/postgres`).

The EPUB reader lives in `src/hearthread/epub/`; the generator only calls `parse(path)` (contract in
`src/hearthread/book.py`).
