-- Telegram is the audio store: keep the file ids a bot needs to download, and let a book be
-- private to one member (the captain's imported library).

-- Phones never see these columns (the column grants in the access-rules migration list the
-- readable ones); only the generator and the download-links function (service role) do.
alter table public.chapters
  add column telegram_audio_file_id         text,
  add column telegram_audio_file_unique_id  text,
  add column telegram_timing_file_id        text,
  add column telegram_timing_file_unique_id text;

alter table public.books
  add column cover_file_id text,
  -- null = every active member; set = only that member (restrict: removing the member must
  -- not quietly make the book public)
  add column private_to uuid references public.members (user_id) on delete restrict;

-- The policies below read private_to as the signed-in user, so it needs a column grant. It is
-- only ever visible on rows that user can already see, where it is their own id.
grant select (private_to) on public.books to authenticated;

drop policy published on public.books;
create policy published on public.books
  for select to authenticated using (
    public.is_member() and status = 'published'
    and (private_to is null or private_to = auth.uid())
  );

drop policy ready on public.chapters;
create policy ready on public.chapters
  for select to authenticated using (
    public.is_member()
    and status = 'ready'
    and exists (select 1 from public.books b where b.id = book_id and b.status = 'published'
                  and (b.private_to is null or b.private_to = auth.uid()))
  );
