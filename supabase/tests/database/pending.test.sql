-- Username sign-in: a registered but not yet approved member ('pending') gets nothing.
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d4', 'waiting@users.hearthread.invalid'),
  ('00000000-0000-0000-0000-0000000000a1', 'maria@users.hearthread.invalid'),
  ('00000000-0000-0000-0000-0000000000e5', 'dup@users.hearthread.invalid');

insert into public.members (user_id, email, display_name, username, status) values
  ('00000000-0000-0000-0000-0000000000d4', 'waiting@users.hearthread.invalid', 'waiting', 'waiting', 'pending');
insert into public.members (user_id, email, display_name, username, status, is_admin) values
  ('00000000-0000-0000-0000-0000000000a1', 'maria@users.hearthread.invalid', 'maria', 'maria', 'active', true);

insert into public.books (id, title, status, source_key, source_sha256, parser_version) values
  ('pub', 'Published book', 'published', 'sources/pub.epub', 'abc', 'p1');
insert into public.chapters (book_id, n, title, status, audio_key, timing_key, audio_sha256,
                             text_sha256, input_hash, telegram_audio_msg) values
  ('pub', 1, 'Ready chapter', 'ready', 'books/pub/ch-0001.mp3', 'books/pub/ch-0001.timing.json', 'h1', 't1', 'i1', 11);

-- Rules at the table level (as owner) ----------------------------------------------------------
select is(
  (select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'members' and column_name = 'status'),
  '''pending''::text', 'a member row starts out pending unless someone says otherwise');
select throws_ok(
  $$update public.members set status = 'approved' where username = 'waiting'$$,
  '23514', null, 'only pending, active and revoked are valid statuses');
select throws_ok(
  $$insert into public.members (user_id, email, display_name, username)
    values ('00000000-0000-0000-0000-0000000000e5', 'dup@users.hearthread.invalid', 'x', 'Bad Name')$$,
  '23514', null, 'usernames are 3 to 20 lowercase letters, digits or underscores');
select throws_ok(
  $$insert into public.members (user_id, email, display_name, username)
    values ('00000000-0000-0000-0000-0000000000e5', 'dup@users.hearthread.invalid', 'y', 'waiting')$$,
  '23505', null, 'a username can only be taken once');

-- Pending: signed in, sees only their own row, nothing else ------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_member(), false, 'pending user is not a member');
select is((select count(*) from public.members)::int, 1, 'pending user sees their own member row');
select is((select status from public.members), 'pending', 'and it says pending (the app shows "waiting for approval")');
select is((select username from public.members), 'waiting', 'username is readable on the own row');
select is((select is_admin from public.members), false, 'pending user is not an admin');
select is((select count(*) from public.books)::int,    0, 'pending user sees no books');
select is((select count(*) from public.chapters)::int, 0, 'pending user sees no chapters');
select throws_ok('select count(*) from public.jobs', '42501', null, 'pending user cannot read jobs');
select throws_ok($$update public.members set status = 'active'$$, '42501', null, 'pending user cannot approve themselves');
select throws_ok($$update public.members set is_admin = true$$,   '42501', null, 'pending user cannot make themselves admin');
reset role;

-- Approval (what the accounts function does with the service role) opens the doors -------------
update public.members set status = 'active' where username = 'waiting';
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated"}', true);
set local role authenticated;
select is(public.is_member(), true, 'once approved the same user is a member');
select is((select count(*) from public.books)::int, 1, 'and sees the published book');
reset role;

-- A normal member cannot see other members' usernames or flags ---------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.members)::int, 1, 'even an admin reads only their own row through the API (the list comes from the function)');
reset role;

select * from finish();
rollback;
