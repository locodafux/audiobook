-- Access rules: stranger / signed-in non-member / revoked / active / column access / writes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- Fixtures (as the owner role, which bypasses RLS) ----------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'active@example.test'),
  ('00000000-0000-0000-0000-0000000000b2', 'revoked@example.test'),
  ('00000000-0000-0000-0000-0000000000c3', 'nobody@example.test');   -- signed in, never invited

insert into public.members (user_id, email, display_name, invited_by, status, revoked_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'active@example.test',  'Active',  'Leo', 'active',  null),
  ('00000000-0000-0000-0000-0000000000b2', 'revoked@example.test', 'Revoked', 'Leo', 'revoked', now());

insert into public.books (id, title, status, source_key, source_sha256, parser_version) values
  ('pub',   'Published book', 'published', 'sources/pub.epub',   'abc', 'p1'),
  ('draft', 'Draft book',     'draft',     'sources/draft.epub', 'def', 'p1'),
  ('arch',  'Archived book',  'archived',  'sources/arch.epub',  'ghi', 'p1');

insert into public.chapters (book_id, n, title, status, audio_key, timing_key, audio_sha256,
                             text_sha256, input_hash, telegram_audio_msg) values
  ('pub',   1, 'Ready chapter',   'ready',   'books/pub/ch-0001.mp3', 'books/pub/ch-0001.timing.json', 'h1', 't1', 'i1', 11),
  ('pub',   2, 'Pending chapter', 'pending', null, null, null, null, null, null),
  ('pub',   3, 'Failed chapter',  'failed',  null, null, null, null, null, null),
  ('draft', 1, 'Ready, draft book',    'ready', 'books/draft/ch-0001.mp3', 'books/draft/ch-0001.timing.json', 'h2', 't2', 'i2', 12),
  ('arch',  1, 'Ready, archived book', 'ready', 'books/arch/ch-0001.mp3',  'books/arch/ch-0001.timing.json',  'h3', 't3', 'i3', 13);

insert into public.jobs (kind, book_id, chapter_n) values ('chapter', 'pub', 2);

-- Constraints and queue (as owner) ---------------------------------------------------------------
select throws_ok(
  $$insert into public.members (user_id, email, display_name)
    values ('00000000-0000-0000-0000-0000000000c3', 'Nobody@Example.test', 'X')$$,
  '23514', null, 'member emails must be lowercase');

select throws_ok(
  $$insert into public.jobs (kind, book_id, chapter_n) values ('chapter', 'pub', 2)$$,
  '23505', null, 'second queued chapter job for the same chapter is refused');

select lives_ok(
  $$insert into public.jobs (kind, book_id, chapter_n) values ('backup', 'pub', 2)$$,
  'a backup job for the same chapter is a different kind, so it is allowed');

update public.jobs set status = 'done' where kind = 'chapter' and book_id = 'pub' and chapter_n = 2;
select lives_ok(
  $$insert into public.jobs (kind, book_id, chapter_n) values ('chapter', 'pub', 2)$$,
  'once the first job is done a new one can be queued');

-- Stranger: no sign-in (role anon) --------------------------------------------------------------
set local role anon;
select throws_ok('select count(*) from public.members',  '42501', null, 'anon cannot read members');
select throws_ok('select count(*) from public.books',    '42501', null, 'anon cannot read books');
select throws_ok('select count(*) from public.chapters', '42501', null, 'anon cannot read chapters');
select throws_ok('select count(*) from public.jobs',     '42501', null, 'anon cannot read jobs');
select is(public.ping(), 'ok', 'anon can call ping()');
select throws_ok('select public.is_member()', '42501', null, 'anon cannot call is_member()');
select throws_ok($$insert into public.books (id, title) values ('x', 'x')$$, '42501', null, 'anon cannot insert books');
reset role;

-- Signed in but never invited --------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000c3","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.members)::int,  0, 'non-member sees no members');
select is((select count(*) from public.books)::int,    0, 'non-member sees no books');
select is((select count(*) from public.chapters)::int, 0, 'non-member sees no chapters');
select is(public.is_member(), false, 'non-member is not a member');
reset role;

-- Signed in but revoked --------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.members)::int, 1, 'revoked user sees their own member row');
select is((select status from public.members), 'revoked', 'revoked user can see that access ended');
select is((select count(*) from public.books)::int,    0, 'revoked user sees no books');
select is((select count(*) from public.chapters)::int, 0, 'revoked user sees no chapters');
select is(public.is_member(), false, 'revoked user is not a member');
select throws_ok('select count(*) from public.jobs', '42501', null, 'revoked user cannot read jobs');
reset role;

-- Active member ----------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_member(), true, 'active user is a member');
select is((select count(*) from public.members)::int, 1, 'member sees only their own member row');
select is((select email from public.members), 'active@example.test', 'and it is theirs');
select is((select count(*) from public.books)::int, 1, 'member sees only the published book');
select is((select id from public.books), 'pub', 'and it is the published one');
select is((select count(*) from public.chapters)::int, 1,
  'member sees only ready chapters of published books (not pending, failed, draft or archived)');
select is((select n from public.chapters), 1, 'and it is chapter 1 of the published book');
select lives_ok('select id, title, author, series_title, volume, description, language, cover_key, chapter_count, total_duration_s, total_bytes, status from public.books',
  'safe book columns are readable');
select lives_ok('select book_id, n, title, status, duration_s, bytes, sentence_count, audio_sha256 from public.chapters',
  'safe chapter columns are readable');
select throws_ok('select audio_key from public.chapters',          '42501', null, 'chapters.audio_key is hidden');
select throws_ok('select timing_key from public.chapters',         '42501', null, 'chapters.timing_key is hidden');
select throws_ok('select input_hash from public.chapters',         '42501', null, 'chapters.input_hash is hidden');
select throws_ok('select telegram_audio_msg from public.chapters', '42501', null, 'chapters.telegram_audio_msg is hidden');
select throws_ok('select * from public.chapters',                  '42501', null, 'select * on chapters is refused (hidden columns)');
select throws_ok('select source_key from public.books',            '42501', null, 'books.source_key is hidden');
select throws_ok('select source_sha256 from public.books',         '42501', null, 'books.source_sha256 is hidden');
select throws_ok('select count(*) from public.jobs',               '42501', null, 'member cannot read jobs');

-- Writes: nobody but the owner role ---------------------------------------------------------------
select throws_ok($$insert into public.books (id, title) values ('x', 'x')$$, '42501', null, 'member cannot insert books');
select throws_ok($$update public.books set title = 'hacked'$$,                '42501', null, 'member cannot update books');
select throws_ok($$delete from public.chapters$$,                             '42501', null, 'member cannot delete chapters');
select throws_ok($$update public.members set status = 'active'$$,             '42501', null, 'member cannot edit members');
select throws_ok($$insert into public.jobs (kind, book_id, chapter_n) values ('chapter', 'pub', 3)$$, '42501', null, 'member cannot queue jobs');
reset role;

-- Service role (generator / link function): full access through the API --------------------------
set local role service_role;
select is((select count(*) from public.books)::int, 3, 'service role reads every book');
select is((select count(*) from public.jobs)::int, 3, 'service role reads jobs');
select lives_ok($$update public.chapters set status = 'ready' where book_id = 'pub' and n = 2$$, 'service role can update chapters');
reset role;

select * from finish();
rollback;
