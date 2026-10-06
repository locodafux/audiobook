# download-links

Supabase Edge Function (Deno). A signed-in, approved (active) member sends a book and chapter numbers;
the function replies with 15-minute presigned R2 links. It never carries audio.

**Request** (`POST`, `Authorization: Bearer <member token>`), one of:

```json
{ "book_id": "my-book", "chapters": [5, 6, 7] }   // 1 to 25 chapter numbers
{ "book_ids": ["my-book", "other-book"] }         // cover pictures, up to 50 books
```

**Reply** `200`: `{ "expires_in": 900, "chapters": [...] }` where each item is
`{ n, audio_url, timing_url, bytes, sha256 }`, or `{ n, error: "not_available" }` when the book is
not published or the chapter is not ready. Covers reply
`{ "covers": [{ book_id, url } | { book_id, error: "not_available" }] }` (no cover = not available).
Revoked or unknown members get `403 { "error": "access_ended" }`; bad input `400`.

The platform verifies the token (keep `verify_jwt` on); the function then reads `members`, `books`
and `chapters` with the service key, so revoked friends are refused even while their token is still
valid.

## Secrets (names only)

`R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_READ_KEY_ID`, `R2_READ_SECRET` (read key scoped to Object Read on
the one bucket). Listed in `.env.example`; set with `supabase secrets set`. `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` are injected by the platform.

## Checks

```sh
cd supabase/functions/download-links
deno fmt --check && deno lint && deno test
```
