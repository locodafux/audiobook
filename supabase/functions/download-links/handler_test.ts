import { assert, assertEquals } from "@std/assert";
import { type BookRow, type ChapterRow, type Deps, handle } from "./handler.ts";

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
  telegram_audio_file_id: `A${n}`,
  telegram_timing_file_id: `T${n}`,
});
const pub: BookRow = { id: "b1", status: "published", cover_file_id: "C1", private_to: null };

function fake(
  over: Partial<{
    member: string | null;
    book: BookRow;
    chapters: ChapterRow[];
    gone: string[];
    down: boolean;
  }> = {},
) {
  const asked: string[] = [];
  const member = "member" in over ? over.member! : "active";
  const book = over.book ?? pub;
  const chapters = over.chapters ?? [ch(1), ch(2), ch(3), ch(4, "pending")];
  const deps: Deps = {
    memberStatus: () => Promise.resolve(member),
    books: (ids) => Promise.resolve(ids.includes(book.id) ? [book] : []),
    chapters: (_, ns) => Promise.resolve(chapters.filter((c) => ns.includes(c.n))),
    telegramUrl: (id) => {
      asked.push(id);
      if (over.down) return Promise.reject(new Error("https://api.telegram.org/botSECRET/x"));
      return Promise.resolve(over.gone?.includes(id) ? null : `https://tg/${id}`);
    },
  };
  return { deps, asked };
}

Deno.test("deny when pending approval, revoked or unknown, even with a valid token, and ask Telegram nothing", async () => {
  for (const member of ["pending", "revoked", "rejected", null]) {
    const { deps, asked } = fake({ member });
    for (const body of [{ book_id: "b1", chapters: [1] }, { book_ids: ["b1"] }]) {
      const res = await handle(call(body), deps);
      assertEquals(res.status, 403);
      assertEquals((await res.json()).error, "access_ended");
    }
    assertEquals(asked, []);
  }
});

Deno.test("deny when not ready or not published", async () => {
  const a = fake();
  const res = await handle(call({ book_id: "b1", chapters: [4, 9] }), a.deps);
  assertEquals((await res.json()).chapters, [
    { n: 4, error: "not_available" },
    { n: 9, error: "not_available" },
  ]);
  assertEquals(a.asked, []);

  const b = fake({ book: { ...pub, status: "draft" } });
  const res2 = await handle(call({ book_id: "b1", chapters: [1] }), b.deps);
  assertEquals((await res2.json()).chapters, [{ n: 1, error: "not_available" }]);
  const res3 = await handle(call({ book_ids: ["b1"] }), b.deps);
  assertEquals((await res3.json()).covers, [{ book_id: "b1", error: "not_available" }]);
  assertEquals(b.asked, []);
});

Deno.test("a chapter with no Telegram file id, or one Telegram lost, is not available", async () => {
  const noId = fake({ chapters: [{ ...ch(1), telegram_audio_file_id: null }, ch(2)] });
  const body = await (await handle(call({ book_id: "b1", chapters: [1, 2] }), noId.deps)).json();
  assertEquals(body.chapters[0], { n: 1, error: "not_available" });
  assertEquals(body.chapters[1].n, 2);

  const lost = fake({ gone: ["T2"] });
  const body2 = await (await handle(call({ book_id: "b1", chapters: [1, 2] }), lost.deps)).json();
  assertEquals(body2.chapters[1], { n: 2, error: "not_available" });
  assertEquals(body2.chapters[0].audio_url, "https://tg/A1");
});

Deno.test("a book private to someone else looks missing; to the caller it is served", async () => {
  const other = fake({ book: { ...pub, private_to: "someone-else" } });
  const body = await (await handle(call({ book_id: "b1", chapters: [1] }), other.deps)).json();
  assertEquals(body.chapters, [{ n: 1, error: "not_available" }]);
  const covers = await (await handle(call({ book_ids: ["b1"] }), other.deps)).json();
  assertEquals(covers.covers, [{ book_id: "b1", error: "not_available" }]);
  assertEquals(other.asked, []);

  const mine = fake({ book: { ...pub, private_to: "u1" } });
  const ok = await (await handle(call({ book_id: "b1", chapters: [1] }), mine.deps)).json();
  assertEquals(ok.chapters[0].audio_url, "https://tg/A1");
});

Deno.test("only the requested files are looked up, and the answer has size and hash", async () => {
  const { deps, asked } = fake();
  const res = await handle(call({ book_id: "b1", chapters: [2, 2, 3] }), deps);
  const body = await res.json();
  assertEquals(asked.sort(), ["A2", "A3", "T2", "T3"]);
  assertEquals(body.chapters[0], {
    n: 2,
    audio_url: "https://tg/A2",
    timing_url: "https://tg/T2",
    bytes: 102,
    sha256: "h2",
  });

  const c = fake();
  const covers = await (await handle(call({ book_ids: ["b1"] }), c.deps)).json();
  assertEquals(covers.covers, [{ book_id: "b1", url: "https://tg/C1" }]);
  assertEquals(c.asked, ["C1"]);
});

Deno.test("links are reported as expiring in 30 minutes, inside Telegram's hour", async () => {
  const { deps } = fake();
  assertEquals(
    (await (await handle(call({ book_id: "b1", chapters: [1] }), deps)).json()).expires_in,
    1800,
  );
});

Deno.test("Telegram being down is 502 and says nothing about why", async () => {
  const res = await handle(call({ book_id: "b1", chapters: [1] }), fake({ down: true }).deps);
  assertEquals(res.status, 502);
  const text = await res.text();
  assertEquals(JSON.parse(text), { error: "storage_unavailable" });
  assert(!text.includes("SECRET"));
});

Deno.test("rejects bad input and anonymous tokens", async () => {
  const { deps, asked } = fake();
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
  assertEquals(asked, []);
});
