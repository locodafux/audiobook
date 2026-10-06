import { assert, assertEquals } from "@std/assert";
import { type Book, type Chapter, type Deps, handle, parseRange } from "./handler.ts";

const AUDIO = new TextEncoder().encode("0123456789abcdefghij"); // 20 bytes
const TIMING = new TextEncoder().encode('{"v":1}');

const stream = (bytes: Uint8Array, chunk = 7, onCancel?: () => void) => {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(ctl) {
      if (at >= bytes.length) return ctl.close();
      ctl.enqueue(bytes.slice(at, at + chunk));
      at += chunk;
    },
    cancel: onCancel,
  });
};

const ready = (over: Partial<Chapter> = {}): Chapter => ({
  n: 1,
  status: "ready",
  telegram_audio_file_id: "A1",
  telegram_timing_file_id: "T1",
  ...over,
});

function fake(over: Partial<{
  member: string | null;
  user: string | null;
  book: Book | null;
  chapter: Chapter | null;
  gone: boolean;
  down: boolean;
}> = {}) {
  const calls: string[] = [];
  const state = { cancelled: false };
  const member = "member" in over ? over.member! : "active";
  const deps: Deps = {
    userId: (t) => {
      calls.push("userId");
      return Promise.resolve("user" in over ? over.user! : t === "bad" ? null : "u1");
    },
    memberStatus: () => {
      calls.push("member");
      return Promise.resolve(member);
    },
    book: () =>
      Promise.resolve(
        "book" in over ? over.book! : { id: "b1", status: "published", private_to: null },
      ),
    chapter: () => Promise.resolve("chapter" in over ? over.chapter! : ready()),
    telegramFile: (id) => {
      calls.push(`telegram:${id}`);
      if (over.down) return Promise.reject(new Error("telegram unreachable"));
      if (over.gone) return Promise.resolve(null);
      const bytes = id === "T1" ? TIMING : AUDIO;
      return Promise.resolve({
        body: stream(bytes, 7, () => state.cancelled = true),
        size: bytes.length,
      });
    },
  };
  return { deps, calls, state };
}

const get = (path: string, headers: HeadersInit = { authorization: "Bearer good" }) =>
  new Request(`http://x${path}`, { headers });
const text = async (res: Response) => new TextDecoder().decode(await res.arrayBuffer());

Deno.test("an active member gets the audio, with length and range support advertised", async () => {
  const { deps, calls } = fake();
  const res = await handle(get("/audio/b1/1"), deps);
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "audio/mpeg");
  assertEquals(res.headers.get("content-length"), "20");
  assertEquals(res.headers.get("accept-ranges"), "bytes");
  assertEquals(res.headers.get("cache-control"), "private, no-store");
  assertEquals(await text(res), "0123456789abcdefghij");
  assert(calls.includes("telegram:A1"));
});

Deno.test("the timing route serves the timing file", async () => {
  const { deps, calls } = fake();
  const res = await handle(get("/timing/b1/1"), deps);
  assertEquals(res.headers.get("content-type"), "application/json");
  assertEquals(await text(res), '{"v":1}');
  assert(calls.includes("telegram:T1") && !calls.includes("telegram:A1"));
});

Deno.test("no token or a bad token is 401 and Telegram is never asked", async () => {
  for (
    const headers of [{} as Record<string, string>, { authorization: "Bearer bad" }, {
      authorization: "Basic abc",
    }]
  ) {
    const { deps, calls } = fake();
    const res = await handle(get("/audio/b1/1", headers), deps);
    assertEquals(res.status, 401);
    assert(!calls.some((c) => c.startsWith("telegram")));
  }
});

Deno.test("pending, rejected, revoked and unknown members are refused even with a valid token", async () => {
  for (const member of ["pending", "rejected", "revoked", null]) {
    const { deps, calls } = fake({ member });
    const res = await handle(get("/audio/b1/1"), deps);
    assertEquals(res.status, 403, String(member));
    assertEquals((await res.json()).error, "access_ended");
    assertEquals(calls, ["userId", "member"]); // nothing fetched from Telegram
  }
});

Deno.test("only GET, only the two routes, only sane ids", async () => {
  const { deps } = fake();
  assertEquals(
    (await handle(new Request("http://x/audio/b1/1", { method: "POST" }), deps)).status,
    405,
  );
  for (
    const path of [
      "/",
      "/audio/b1",
      "/audio/b1/0",
      "/audio/b1/x",
      "/other/b1/1",
      "/audio/../1/1",
      "/audio/b1/1/extra",
    ]
  ) {
    assertEquals((await handle(get(path), deps)).status, 404, path);
  }
});

Deno.test("not published, not ready, no file id, gone from Telegram: all 404 not_available", async () => {
  const cases = [
    fake({ book: { id: "b1", status: "draft", private_to: null } }),
    fake({ book: null }),
    fake({ chapter: ready({ status: "pending" }) }),
    fake({ chapter: ready({ telegram_audio_file_id: null }) }),
    fake({ chapter: null }),
    fake({ gone: true }),
  ];
  for (const { deps } of cases) {
    const res = await handle(get("/audio/b1/1"), deps);
    assertEquals(res.status, 404);
    assertEquals((await res.json()).error, "not_available");
  }
});

Deno.test("a book private to someone else looks missing; to the caller it is served", async () => {
  const other = fake({ book: { id: "b1", status: "published", private_to: "someone-else" } });
  assertEquals((await handle(get("/audio/b1/1"), other.deps)).status, 404);
  assert(!other.calls.some((c) => c.startsWith("telegram")));
  const mine = fake({ book: { id: "b1", status: "published", private_to: "u1" } });
  assertEquals((await handle(get("/audio/b1/1"), mine.deps)).status, 200);
});

Deno.test("Telegram being down is 502, not a leak", async () => {
  const res = await handle(get("/audio/b1/1"), fake({ down: true }).deps);
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error, "storage_unavailable");
});

Deno.test("Range: a slice, open end, suffix, and an end past the file", async () => {
  const cases: [string, number, string, string][] = [
    ["bytes=2-5", 206, "2345", "bytes 2-5/20"],
    ["bytes=15-", 206, "fghij", "bytes 15-19/20"],
    ["bytes=-3", 206, "hij", "bytes 17-19/20"],
    ["bytes=18-999", 206, "ij", "bytes 18-19/20"],
    ["bytes=0-0", 206, "0", "bytes 0-0/20"],
  ];
  for (const [range, status, body, contentRange] of cases) {
    const res = await handle(
      get("/audio/b1/1", { authorization: "Bearer good", range }),
      fake().deps,
    );
    assertEquals(res.status, status, range);
    assertEquals(res.headers.get("content-range"), contentRange);
    assertEquals(res.headers.get("content-length"), String(body.length));
    assertEquals(await text(res), body, range);
  }
});

Deno.test("Range outside the file is 416 with the size; odd syntax just gets the whole file", async () => {
  for (const range of ["bytes=20-", "bytes=99-100", "bytes=-0"]) {
    const res = await handle(
      get("/audio/b1/1", { authorization: "Bearer good", range }),
      fake().deps,
    );
    assertEquals(res.status, 416, range);
    assertEquals(res.headers.get("content-range"), "bytes */20");
    await res.body?.cancel();
  }
  for (const range of ["bytes=5-2", "bytes=0-1,5-6", "items=1-2", "bytes=-", "garbage"]) {
    const res = await handle(
      get("/audio/b1/1", { authorization: "Bearer good", range }),
      fake().deps,
    );
    assertEquals(res.status, 200, range);
    assertEquals(await text(res), "0123456789abcdefghij");
  }
});

Deno.test("a range stops reading Telegram as soon as it has its bytes", async () => {
  const { deps, state } = fake();
  const res = await handle(
    get("/audio/b1/1", { authorization: "Bearer good", range: "bytes=0-3" }),
    deps,
  );
  assertEquals(await text(res), "0123");
  assert(state.cancelled);
});

Deno.test("a file whose size Telegram did not give is sent whole, ignoring Range", async () => {
  const { deps } = fake();
  deps.telegramFile = () => Promise.resolve({ body: stream(AUDIO), size: null });
  const res = await handle(
    get("/audio/b1/1", { authorization: "Bearer good", range: "bytes=2-5" }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-length"), null);
  assertEquals((await text(res)).length, 20);
});

Deno.test("parseRange edge cases", () => {
  assertEquals(parseRange(null, 10), null);
  assertEquals(parseRange("bytes=0-", 0), "unsatisfiable");
  assertEquals(parseRange("bytes=-5", 3), { start: 0, end: 2 });
  assertEquals(parseRange("bytes=9-9", 10), { start: 9, end: 9 });
});
