# hearthread (generator)

The Mac-side CLI: turns an EPUB into one audio file per chapter, stores it in Telegram (with its own
copy in a local library folder), and manages invites. Plan: section 6 of the Hearthread technical plan.

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

**Where audio lives.** A chapter is only listenable after Telegram has accepted both of its files; the
`file_id`s are stored on the chapter (hidden from phones, which get download links from the `download-links` function). The
Mac keeps a copy in the library folder (`HEARTHREAD_LIBRARY_DIR`, default `library/` beside the state
folder). **That folder is the real backup**: if Telegram ever drops files, `hearthread backup-retry --all`
uploads them again from it.

**Importing audio the previous app already voiced** (local `processed/` folders, never committed):

```sh
uv run hearthread --prod import-voiced /path/to/processed/shadow-slave-vol-01-chapters-1-95 \
  --id shadow-slave-01 --title "Shadow Slave, Vol. 1" --author "Guiltythree" \
  --series "Shadow Slave" --volume 1 --first-chapter 1 --private-to your-username
```

Each `chapter_NN.mp3` + `chapter_NN_timing.json` is copied into the library folder, uploaded to Telegram
(about 6 s a chapter because of Telegram's send limits), converted to the new timing format and
recorded. `--private-to` (a username, or an email) makes the book visible to that member only; they must already be a member.
Run it again after an interruption: finished chapters are skipped. `--limit 3` is a cheap first try.
The book only appears once every chapter is in. Run it once per volume.

Everything defaults to **dev**. Real data needs `--prod`.

Tests (`uv run pytest`) use fakes for voice, Telegram and the EPUB parser, so nothing touches the
network. Queue/pipeline/invite tests need the local Supabase database (`supabase start`, then
`supabase db reset`); without it they skip with the reason. They refuse any non-local database host
and **empty the jobs/chapters/books/members tables**, so only point them at a throw-away database
(`TEST_DATABASE_URL`, default `postgresql://postgres:postgres@127.0.0.1:54322/postgres`).

The EPUB reader lives in `src/hearthread/epub/`; the generator only calls `parse(path)` (contract in
`src/hearthread/book.py`).
