import { assert, assertEquals } from "@std/assert";
import { type BookRow, type ChapterRow, type Deps, handle } from "./handler.ts";
import { r2Signer } from "./index.ts";

const jwt = (sub?: string) => `h.${btoa(JSON.stringify(sub ? { sub } : { role: "anon" }))}.s`;
const call = (body: unknown, token = jwt("u1")) =>
  new Request("http://x/", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

const ch = (n: number, status = "ready"): ChapterRow => ({
  n,
  status,
  bytes: 100 + n,
  audio_sha256: `h${n}`,
  audio_key: `books/b1/ch-000${n}.mp3`,
  timing_key: `books/b1/ch-000${n}.timing.json`,
});

function fake(
  over: Partial<{ member: string | null; book: BookRow; chapters: ChapterRow[] }> = {},
) {
  const signed: string[] = [];
  const member = "member" in over ? over.member! : "active";
  const book = over.book ?? { id: "b1", status: "published", cover_key: "books/b1/cover.jpg" };
  const chapters = over.chapters ?? [ch(1), ch(2), ch(3), ch(4, "pending")];
  const deps: Deps = {
    memberStatus: () => Promise.resolve(member),
    books: (ids) => Promise.resolve(ids.includes(book.id) ? [book] : []),
    chapters: (_, ns) => Promise.resolve(chapters.filter((c) => ns.includes(c.n))),
    sign: (key) => {
      signed.push(key);
      return Promise.resolve(`https://r2/${key}`);
    },
  };
  return { deps, signed };
}

Deno.test("deny when pending approval, revoked or unknown, even with a valid token, and sign nothing", async () => {
  for (const member of ["pending", "revoked", null]) {
    const { deps, signed } = fake({ member });
    const res = await handle(call({ book_id: "b1", chapters: [1] }), deps);
    assertEquals(res.status, 403);
    assertEquals((await res.json()).error, "access_ended");
    assertEquals(signed, []);
  }
});

Deno.test("deny when not ready or not published", async () => {
  const a = fake();
  const res = await handle(call({ book_id: "b1", chapters: [4, 9] }), a.deps);
  assertEquals((await res.json()).chapters, [
    { n: 4, error: "not_available" },
    { n: 9, error: "not_available" },
  ]);
  assertEquals(a.signed, []);

  const b = fake({ book: { id: "b1", status: "draft", cover_key: "c" } });
  const res2 = await handle(call({ book_id: "b1", chapters: [1] }), b.deps);
  assertEquals((await res2.json()).chapters, [{ n: 1, error: "not_available" }]);
  const res3 = await handle(call({ book_ids: ["b1"] }), b.deps);
  assertEquals((await res3.json()).covers, [{ book_id: "b1", error: "not_available" }]);
  assertEquals(b.signed, []);
});

Deno.test("only the requested keys are signed", async () => {
  const { deps, signed } = fake();
  const res = await handle(call({ book_id: "b1", chapters: [2, 2, 3] }), deps);
  const body = await res.json();
  assertEquals(signed.sort(), [
    "books/b1/ch-0002.mp3",
    "books/b1/ch-0002.timing.json",
    "books/b1/ch-0003.mp3",
    "books/b1/ch-0003.timing.json",
  ]);
  assertEquals(body.chapters[0], {
    n: 2,
    audio_url: "https://r2/books/b1/ch-0002.mp3",
    timing_url: "https://r2/books/b1/ch-0002.timing.json",
    bytes: 102,
    sha256: "h2",
  });

  const c = fake();
  await handle(call({ book_ids: ["b1"] }), c.deps);
  assertEquals(c.signed, ["books/b1/cover.jpg"]);
});

Deno.test("links expire after 900 s", async () => {
  const sign = r2Signer("acct", "bkt", "AKID", "secret");
  const url = new URL(await sign("books/b1/ch-0001.mp3"));
  assertEquals(url.origin, "https://acct.r2.cloudflarestorage.com");
  assertEquals(url.pathname, "/bkt/books/b1/ch-0001.mp3");
  assertEquals(url.searchParams.get("X-Amz-Expires"), "900");
  assertEquals(url.searchParams.get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256");
  assert(url.searchParams.get("X-Amz-Credential")!.endsWith("/auto/s3/aws4_request"));
  assert(url.searchParams.has("X-Amz-Signature"));
  const { deps } = fake();
  assertEquals(
    (await (await handle(call({ book_id: "b1", chapters: [1] }), deps)).json()).expires_in,
    900,
  );
});

Deno.test("rejects bad input and anonymous tokens", async () => {
  const { deps, signed } = fake();
  for (
    const body of [
      {},
      { book_id: "b1", chapters: [] },
      { book_id: "b1", chapters: [0] },
      { book_id: "b1", chapters: Array.from({ length: 26 }, (_, i) => i + 1) },
      { book_id: "../x", chapters: [1] },
      { book_id: "b1", chapters: [1], book_ids: ["b1"] },
    ]
  ) {
    assertEquals((await handle(call(body), deps)).status, 400);
  }
  assertEquals((await handle(call({ book_id: "b1", chapters: [1] }, jwt()), deps)).status, 401);
  assertEquals(signed, []);
});
