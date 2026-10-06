-- Username + password sign-in with in-app approval (replaces the emailed link / code).
-- New people register through the `accounts` function and start as 'pending'. Every existing
-- rule keys on status = 'active' (is_member(), the link function), so a pending member gets
-- nothing from the server until an admin approves them.

alter table public.members drop constraint members_status_check;
alter table public.members add constraint members_status_check
  check (status in ('pending', 'active', 'revoked'));
-- A row nobody vetted never starts out with access.
alter table public.members alter column status set default 'pending';

alter table public.members
  add column username text unique check (username ~ '^[a-z0-9_]{3,20}$'),
  add column is_admin boolean not null default false;

-- A member reads their own row only (policy own_row); phones still cannot write members.
grant select (username, is_admin) on public.members to authenticated;

-- The first admin. Their auth account is switched to the username login with
-- scripts/set-admin-login.sh (see docs/setup-accounts.md); a fresh local database has no such row.
update public.members
   set is_admin = true, username = 'leo'
 where email = 'leonardotimkangjr@gmail.com' and status = 'active';
