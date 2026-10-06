# accounts

Supabase Edge Function (Deno). The only way an account is created or approved, so Supabase's public
sign-up stays off. It uses the `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` that Supabase provides
to every function; there is nothing to configure. The service-role key never reaches the app.

Usernames become the internal email `<username>@users.hearthread.invalid` (never shown, never
mailed, created already confirmed). The app logs in directly with that address and the password.

`POST`, JSON body with an `action`:

| action                                 | who    | what                                                                                                                                                                           |
| -------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `register` `{username, password}`      | anyone | creates the account and a `pending` member. Usernames are 3 to 20 of `a-z 0-9 _`; passwords 8 to 72 bytes. 409 `username_taken`, 429 `registration_full` (50 pending at once). |
| `list`                                 | admin  | every member: user id, username, status, admin flag.                                                                                                                           |
| `set_status` `{user_id, status}`       | admin  | `active` approves, `revoked` rejects. An admin cannot be revoked.                                                                                                              |
| `reset_password` `{user_id, password}` | admin  | sets a new password (no email reset exists).                                                                                                                                   |

"Admin" means the caller's token belongs to an `active` member with `is_admin = true`.

```sh
cd supabase/functions/accounts
deno test --frozen   # fakes the database and Auth; nothing is contacted
supabase functions deploy accounts --project-ref <ref>
```
