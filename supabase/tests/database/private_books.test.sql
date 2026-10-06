-- A book private to one member is invisible to everyone else; Telegram file ids are never readable by phones.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'friend@example.test');
insert into public.members (user_id, email, display_name) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@example.test',  'Owner'),
  ('00000000-0000-0000-0000-0000000000a2', 'friend@example.test', 'Friend');

insert into public.books (id, title, status, private_to) values
  ('open', 'Open book',    'published', null),
  ('mine', 'Private book', 'published', '00000000-0000-0000-0000-0000000000a1');
insert into public.chapters (book_id, n, title, status, telegram_audio_file_id, telegram_timing_file_id) values
  ('open', 1, 'One', 'ready', 'fa', 'ft'),
  ('mine', 1, 'One', 'ready', 'fa', 'ft');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*) from public.books)::int, 2, 'the owner sees the open and the private book');
select is((select count(*) from public.chapters)::int, 2, 'the owner sees both books'' chapters');
select throws_ok('select telegram_audio_file_id from public.chapters', '42501', null, 'phones cannot read file ids');
select throws_ok('select cover_file_id from public.books', '42501', null, 'phones cannot read cover file ids');
reset role;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
set local role authenticated;
select is((select id from public.books), 'open', 'another member sees only the open book');
select is((select count(*) from public.chapters)::int, 1, 'another member sees only its chapters');
select is((select count(*) from public.chapters where book_id = 'mine')::int, 0, 'no chapter of the private book leaks');
reset role;

select throws_ok(
  $$delete from public.members where user_id = '00000000-0000-0000-0000-0000000000a1'$$,
  '23503', null, 'removing the owner is refused while a book is private to them');
select lives_ok(
  $$update public.books set private_to = null where id = 'mine'$$, 'the generator can make a book open again');

select * from finish();
rollback;
