# audio-proxy

Deno (Deno Deploy). A signed-in, still-active member asks for one chapter; the proxy fetches it from
Telegram and streams it to the phone. It is the only place the bot token lives besides the Mac.

```
GET /audio/<book_id>/<n>     Authorization: Bearer <member token>   -> the chapter's mp3
GET /timing/<book_id>/<n>    same                                    -> its timing JSON
```

Steps, in order, none of which are skippable:

1. Supabase Auth `/auth/v1/user` with the member's token says who they are (`401` if the token is
   bad).
2. `members.status` must be `active`; pending, rejected, revoked or unknown people get
   `403 access_ended` even with a valid token.
3. The book must be published, the chapter `ready`, and the book not `private_to` someone else (a
   private book answers `404`, same as a missing one). The file ids are read with the service key;
   phones cannot read them.
4. Telegram `getFile`, then the bytes are streamed through, never buffered. `Range` is honoured
   (`206`, `416`); Telegram's file server may ignore it, so the proxy slices the stream itself and
   stops reading upstream once it has the bytes. Odd or multi-range headers get the whole file.

`getFile` / the download URL contain the bot token, so nothing logs them: Telegram errors are
replaced by a fixed message, and anything logged has the token and service key scrubbed.

## Secrets (names only)

`TELEGRAM_BOT_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, set in Deno Deploy
(`deno deploy env add NAME VALUE --secret`). Listed in `.env.example`; never put values in the repo.
Setup steps for the captain: [docs/setup-accounts.md](../docs/setup-accounts.md), section 3.

## Checks

```sh
cd audio-proxy
deno fmt --check && deno lint && deno task test
```

`handler_test.ts` covers the rules with fake lookups; `main_test.ts` runs the real wiring over local
HTTP against a fake Supabase and a fake Telegram (pending/revoked refused, Range, private books, no
token in errors). To try it by hand: `deno task start` with the three variables set to local values.
