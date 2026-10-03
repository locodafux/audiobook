-- Row-level security, column grants and helper functions.
-- Rule of thumb: phones (role `authenticated`) can only read; the generator uses the
-- service role / database owner, which bypass RLS.

-- Start from nothing: Supabase grants ALL on new public tables to anon/authenticated by default.
revoke all on public.members, public.books, public.chapters, public.jobs from anon, authenticated;

-- The service role (generator, link function) bypasses RLS but still needs table privileges;
-- new Supabase projects do not grant them by default.
grant all on public.members, public.books, public.chapters, public.jobs to service_role;

alter table public.members  enable row level security;
alter table public.books    enable row level security;
alter table public.chapters enable row level security;
alter table public.jobs     enable row level security;  -- no policy at all: phones never see jobs

-- True when the signed-in user is an active member. security definer so the check works
-- even though phones cannot read other members' rows.
create function public.is_member() returns boolean
  language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.members m where m.user_id = auth.uid() and m.status = 'active'
  )
$$;
revoke execute on function public.is_member() from public, anon;
grant execute on function public.is_member() to authenticated;

-- Keep-alive / connectivity check, callable without sign-in.
create function public.ping() returns text
  language sql stable set search_path = ''
as $$ select 'ok' $$;
revoke execute on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;

-- members: everyone signed in may read their own row (a revoked user sees "access ended").
create policy own_row on public.members
  for select to authenticated using (user_id = auth.uid());
grant select (user_id, email, display_name, invited_by, status, created_at, revoked_at)
  on public.members to authenticated;

-- books: active members see published books, safe columns only.
create policy published on public.books
  for select to authenticated using (public.is_member() and status = 'published');
grant select (id, title, author, description, language, series_title, volume, cover_key,
              chapter_count, total_duration_s, total_bytes, status)
  on public.books to authenticated;

-- chapters: active members see ready chapters of published books, safe columns only.
create policy ready on public.chapters
  for select to authenticated using (
    public.is_member()
    and status = 'ready'
    and exists (select 1 from public.books b where b.id = book_id and b.status = 'published')
  );
grant select (book_id, n, title, status, duration_s, bytes, sentence_count, audio_sha256)
  on public.chapters to authenticated;
