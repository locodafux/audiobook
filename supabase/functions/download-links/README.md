# download-links

Supabase Edge Function (Deno). A signed-in, approved (active) member sends a book and chapter
numbers; the function asks Telegram (`getFile`) for each file and replies with the direct download
links. It never carries audio; the app downloads straight from Telegram.

**Request** (`POST`, `Authorization: Bearer <member token>`), one of:

```json
{ "book_id": "my-book", "chapters": [5, 6, 7] }   // 1 to 25 chapter numbers
{ "book_ids": ["my-book", "other-book"] }         // cover pictures, up to 50 books
```

**Reply** `200`: `{ "expires_in": 1800, "chapters": [...] }` where each item is
`{ n, audio_url, timing_url, bytes, sha256 }`, or `{ n, error: "not_available" }` when the book is
not published (or private to someone else), the chapter is not ready, or Telegram no longer has the
file. Covers reply `{ "covers": [{ book_id, url } | { book_id, error: "not_available" }] }`.
Pending, revoked or unknown members get `403 { "error": "access_ended" }`; bad input `400`; Telegram
or the database unreachable `502 { "error": "storage_unavailable" }`.

Each link is `https://api.telegram.org/file/bot<token>/<path>`, so **the bot token reaches every
approved member's phone**. The owner accepted that (see `docs/decisions.md`). Telegram keeps a path
valid for about an hour, so the app asks for fresh links for every download and every resume; never
store them. The function logs nothing from Telegram errors, because they would name the token.

The platform verifies the token (keep `verify_jwt` on); the function then reads `members`, `books`
and `chapters` with the service key, so revoked friends are refused even while their token is still
valid.

## Secret (name only)

`TELEGRAM_BOT_TOKEN`, listed in `.env.example`; set with `supabase secrets set`. `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

## Checks

```sh
cd supabase/functions/download-links
deno fmt --check && deno lint && deno test --frozen --allow-net=127.0.0.1
```
