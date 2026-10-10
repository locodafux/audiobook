// The real wiring over local HTTP: a fake Supabase (PostgREST) and a fake Telegram (getFile + file
// download) on 127.0.0.1, with the function's own handler in front.
import { assert, assertEquals } from "@std/assert";
import { app, realDeps } from "./index.ts";

const BOT = "123456:FAKE-BOT-TOKEN";
const KEY = "fake-service-key";
const AUDIO = new Uint8Array(1000).map((_, i) => i % 251);
const jwt = (sub: string) => `h.${btoa(JSON.stringify({ sub }))}.s`;
const members: Record<string, string> = { active: "active", pending: "pending", gone: "revoked" };

function backend() {
  const seen: string[] = [];
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, (req) => {
    const url = new URL(req.url);
    seen.push(url.pathname);
    const json = (b: unknown, status = 200) => Response.json(b, { status });
    if (url.pathname.startsWith("/rest/v1/")) {
      assertEquals(req.headers.get("authorization"), `Bearer ${KEY}`);
      if (url.pathname.endsWith("/members")) {
        const id = url.searchParams.get("user_id")!.replace("eq.", "");
        return json(members[id] ? [{ status: members[id] }] : []);
      }
      if (url.pathname.endsWith("/books")) {
        const ids = url.searchParams.get("id")!;
        return json([
          ...(ids.includes("open")
            ? [{ id: "open", status: "published", cover_file_id: null, private_to: null }]
            : []),
          ...(ids.includes("mine")
            ? [{ id: "mine", status: "published", cover_file_id: null, private_to: "active" }]
            : []),
        ]);
      }
      if (url.pathname.endsWith("/chapters")) {
        return json([{
          n: 1,
          status: "ready",
          bytes: AUDIO.length,
          audio_sha256: "abc",
          telegram_audio_file_id: "FILE-A",
          telegram_timing_file_id: "FILE-LOST",
        }, {
          n: 2,
          status: "ready",
          bytes: AUDIO.length,
          audio_sha256: "abc",
          telegram_audio_file_id: "FILE-A",
          telegram_timing_file_id: "FILE-A",
        }]);
      }
    }
    if (url.pathname === `/bot${BOT}/getFile`) {
      return url.searchParams.get("file_id") === "FILE-A"
        ? json({ ok: true, result: { file_path: "docs/a.mp3" } })
        : json({ ok: false, description: "Bad Request: invalid file_id" }, 400);
    }
    if (url.pathname === `/file/bot${BOT}/docs/a.mp3`) {
      return new Response(AUDIO, { headers: { "content-length": String(AUDIO.length) } });
    }
    return json({}, 404);
  });
  return { base: `http://127.0.0.1:${server.addr.port}`, seen, close: () => server.shutdown() };
}

async function withFunction(
  fn: (
    call: (body: unknown, sub: string) => Promise<Response>,
    b: ReturnType<typeof backend>,
  ) => Promise<void>,
) {
  const b = backend();
  const env = (n: string) =>
    ({ SUPABASE_URL: b.base, SUPABASE_SERVICE_ROLE_KEY: KEY, TELEGRAM_BOT_TOKEN: BOT })[n]!;
  const handler = app(() => realDeps(env, fetch, b.base), [BOT, KEY]);
  try {
    await fn(
      (body, sub) =>
        handler(
          new Request("http://f/", {
            method: "POST",
            headers: { authorization: `Bearer ${jwt(sub)}` },
            body: JSON.stringify(body),
          }),
        ),
      b,
    );
  } finally {
    await b.close();
  }
}

Deno.test("e2e: an active member gets Telegram links that really download, Range included", () =>
  withFunction(async (call) => {
    const res = await call({ book_id: "open", chapters: [1, 2] }, "active");
    assertEquals(res.status, 200);
    const { chapters } = await res.json();
    assertEquals(chapters[0], { n: 1, error: "not_available" }); // its timing file is gone from Telegram
    assert(chapters[1].audio_url.endsWith(`/file/bot${BOT}/docs/a.mp3`));
    assertEquals(chapters[1].bytes, 1000);
    const file = await fetch(chapters[1].audio_url);
    assertEquals(new Uint8Array(await file.arrayBuffer()), AUDIO);
  }));

Deno.test("e2e: pending and revoked members get 403 and Telegram is never contacted", () =>
  withFunction(async (call, b) => {
    for (const sub of ["pending", "gone", "stranger"]) {
      const res = await call({ book_id: "open", chapters: [2] }, sub);
      assertEquals(res.status, 403);
      await res.body?.cancel();
    }
    assert(!b.seen.some((p) => p.includes("bot")));
  }));

Deno.test("e2e: a captain-private book is served to the captain and looks missing to a friend", () =>
  withFunction(async (call) => {
    members.friend = "active";
    const mine = await (await call({ book_id: "mine", chapters: [2] }, "active")).json();
    assert(mine.chapters[0].audio_url);
    const friend = await (await call({ book_id: "mine", chapters: [2] }, "friend")).json();
    assertEquals(friend.chapters, [{ n: 2, error: "not_available" }]);
    delete members.friend;
  }));

Deno.test("e2e: errors are logged without the bot token or service key", async () => {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.join(" "));
  try {
    const handler = app(() => ({
      memberStatus: () => Promise.reject(new Error(`boom https://x/bot${BOT}/y ${KEY}`)),
    } as never), [BOT, KEY]);
    const res = await handler(
      new Request("http://f/", {
        method: "POST",
        headers: { authorization: `Bearer ${jwt("active")}` },
        body: JSON.stringify({ book_id: "open", chapters: [1] }),
      }),
    );
    assertEquals(res.status, 500);
  } finally {
    console.error = orig;
  }
  assertEquals(logged.length, 1);
  assert(!logged[0].includes(BOT) && !logged[0].includes(KEY));
});
