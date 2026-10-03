-- Hearthread core tables: members, books, chapters, jobs.
-- Access rules are in the next migration.

create table public.members (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  email        text not null unique check (email = lower(email)),
  display_name text not null,
  invited_by   text,
  status       text not null default 'active' check (status in ('active', 'revoked')),
  created_at   timestamptz not null default now(),
  revoked_at   timestamptz
);

create table public.books (
  id               text primary key,                 -- short name, also the R2 folder
  title            text not null,
  author           text,
  description      text,
  language         text not null default 'en',
  series_title     text,
  volume           integer,
  cover_key        text,                             -- R2 key; null = app draws a gradient
  voice            text not null default 'en-US-BrianNeural',
  rate             text not null default '+0%',
  chapter_count    integer not null default 0,
  total_duration_s numeric not null default 0,
  total_bytes      bigint not null default 0,
  status           text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  -- internal, hidden from phones
  source_key       text,
  source_sha256    text,
  parser_version   text,
  created_at       timestamptz not null default now()
);

create table public.chapters (
  book_id        text not null references public.books (id) on delete cascade,
  n              integer not null check (n >= 1),    -- 1-based, never renumbered once published
  title          text not null,
  status         text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  duration_s     numeric,
  bytes          bigint,
  sentence_count integer,
  audio_sha256   text,
  -- internal, hidden from phones
  audio_key      text,
  timing_key     text,
  source_ref     text,
  text_sha256    text,
  input_hash     text,
  backup_status  text not null default 'none' check (backup_status in ('none', 'done', 'failed')),
  telegram_audio_msg  bigint,
  telegram_timing_msg bigint,
  primary key (book_id, n)
);

create table public.jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null check (kind in ('chapter', 'backup')),
  book_id      text not null,
  chapter_n    integer not null,
  status       text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed')),
  attempts     integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 3 check (max_attempts >= 1),
  run_after    timestamptz not null default now(),
  locked_by    text,
  locked_until timestamptz,
  error        text,
  started_at   timestamptz,
  finished_at  timestamptz,
  created_at   timestamptz not null default now(),
  foreign key (book_id, chapter_n) references public.chapters (book_id, n) on delete cascade
);

-- Adding a book twice cannot double the work: one queued/running job per chapter and kind.
create unique index jobs_one_active_per_chapter
  on public.jobs (book_id, chapter_n, kind)
  where status in ('queued', 'running');

-- Worker claim query: next due queued job.
create index jobs_claim on public.jobs (run_after) where status = 'queued';
