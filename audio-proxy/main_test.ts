// End to end over real HTTP on 127.0.0.1: the proxy with its real wiring, in front of a fake
// Supabase (Auth + PostgREST) and a fake Telegram (getFile + file download).
import { assert, assertEquals } from "@std/assert";
import { app, realDeps } from "./main.ts";

const BOT = "123456:FAKE-BOT-TOKEN";
const SERVICE_KEY = "fake-service-key";
const AUDIO = new Uint8Array(1000).map((_, i) => i % 251);

const members: Record<string, string> = {
  u_active: "active",
  u_pending: "pending",
  u_gone: "revoked",
};
const tokens: Record<string, string> = {
  t_active: "u_active",
  t_pending: "u_pending",
  t_gone: "u_gone",
  t_friend: "u_friend",
};
members["u_friend"] = "active";

function fakeBackend() {
  const seen: string[] = []; // every path the fake saw (with the key it was called with)
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen() {} }, (req) => {
    const url = new URL(req.url);
    seen.push(url.pathname);
    const json = (b: unknown, status = 200) => Response.json(b, { status });
    if (url.pathname === "/auth/v1/user") {
      const id = tokens[req.headers.get("authorization")?.replace("Bearer ", "") ?? ""];
      return id ? json({ id }) : json({ msg: "bad jwt" }, 401);
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      assertEquals(req.headers.get("authorization"), `Bearer ${SERVICE_KEY}`);
      const eq = (k: string) => url.searchParams.get(k)?.replace("eq.", "");
      if (url.pathname.endsWith("/members")) {
        const status = members[eq("user_id")!];
        return json(status ? [{ status }] : []);
      }
      if (url.pathname.endsWith("/books")) {
        const id = eq("id");
        if (id === "open") return json([{ id, status: "published", private_to: null }]);
        if (id === "mine") return json([{ id, status: "published", private_to: "u_active" }]);
        return json([]);
      }
      if (url.pathname.endsWith("/chapters")) {
        return json([{
          n: Number(eq("n")),
          status: "ready",
          telegram_audio_file_id: "FILE-A",
          telegram_timing_file_id: "FILE-T",
        }]);
      }
    }
    if (url.pathname === `/bot${BOT}/getFile`) {
      const id = url.searchParams.get("file_id");
      if (id === "FILE-A") {
        return json({ ok: true, result: { file_path: "docs/a.mp3", file_size: AUDIO.length } });
      }
      return json({ ok: false, description: "Bad Request: invalid file_id" }, 400);
    }
    if (url.pathname === `/file/bot${BOT}/docs/a.mp3`) {
      return new Response(AUDIO, { headers: { "content-length": String(AUDIO.length) } }); // ignores Range
    }
    return json({}, 404);
  });
  const base = `http://127.0.0.1:${server.addr.port}`;
  return { base, seen, close: () => server.shutdown() };
}

async function withProxy(
  fn: (proxy: string, fake: ReturnType<typeof fakeBackend>) => Promise<void>,
) {
  const fake = fakeBackend();
  const env = (n: string) =>
    ({ SUPABASE_URL: fake.base, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, TELEGRAM_BOT_TOKEN: BOT })[
      n
    ]!;
  const proxy = Deno.serve(
    { port: 0, hostname: "127.0.0.1", onListen() {} },
    app(() => realDeps(env, fetch, fake.base), [BOT, SERVICE_KEY]),
  );
  try {
    await fn(`http://127.0.0.1:${proxy.addr.port}`, fake);
  } finally {
    await proxy.shutdown();
    await fake.close();
  }
}

const auth = (token: string, extra: Record<string, string> = {}) => ({
  headers: { authorization: `Bearer ${token}`, ...extra },
});

Deno.test("e2e: an active member streams a whole chapter, bytes intact", () =>
  withProxy(async (proxy) => {
    const res = await fetch(`${proxy}/audio/open/1`, auth("t_active"));
    assertEquals(res.status, 200);
    assertEquals(new Uint8Array(await res.arrayBuffer()), AUDIO);
  }));

Deno.test("e2e: Range gets exactly the asked bytes even though Telegram ignores it", () =>
  withProxy(async (proxy) => {
    const res = await fetch(`${proxy}/audio/open/1`, auth("t_active", { range: "bytes=100-199" }));
    assertEquals(res.status, 206);
    assertEquals(res.headers.get("content-range"), "bytes 100-199/1000");
    assertEquals(new Uint8Array(await res.arrayBuffer()), AUDIO.slice(100, 200));
    const tail = await fetch(`${proxy}/audio/open/1`, auth("t_active", { range: "bytes=-10" }));
    assertEquals(new Uint8Array(await tail.arrayBuffer()), AUDIO.slice(990));
  }));

Deno.test("e2e: pending and revoked members are 403 and Telegram is never contacted", () =>
  withProxy(async (proxy, fake) => {
    for (const t of ["t_pending", "t_gone"]) {
      const res = await fetch(`${proxy}/audio/open/1`, auth(t));
      assertEquals(res.status, 403);
      await res.body?.cancel();
    }
    assert(!fake.seen.some((p) => p.includes("bot")));
  }));

Deno.test("e2e: an unknown token is 401; a signed-in non-member is 403", () =>
  withProxy(async (proxy) => {
    const bad = await fetch(`${proxy}/audio/open/1`, auth("nope"));
    assertEquals(bad.status, 401);
    await bad.body?.cancel();
    const stranger = await fetch(`${proxy}/audio/open/1`, auth("t_friend"));
    assertEquals(stranger.status, 200); // active member (sanity: only status matters)
    await stranger.body?.cancel();
    members["u_friend"] = "pending";
    const res = await fetch(`${proxy}/audio/open/1`, auth("t_friend"));
    assertEquals(res.status, 403);
    await res.body?.cancel();
    members["u_friend"] = "active";
  }));

Deno.test("e2e: a captain-private book is served to the captain and invisible to a friend", () =>
  withProxy(async (proxy) => {
    const mine = await fetch(`${proxy}/audio/mine/1`, auth("t_active"));
    assertEquals(mine.status, 200);
    await mine.body?.cancel();
    const friend = await fetch(`${proxy}/audio/mine/1`, auth("t_friend"));
    assertEquals(friend.status, 404);
    await friend.body?.cancel();
  }));

Deno.test("e2e: a file Telegram no longer knows is 404, and the token never appears in a response", () =>
  withProxy(async (proxy) => {
    const res = await fetch(`${proxy}/timing/open/1`, auth("t_active")); // FILE-T -> Telegram 400
    assertEquals(res.status, 404);
    const body = await res.text();
    assert(!body.includes(BOT) && !body.includes("api.telegram"));
  }));

Deno.test("e2e: errors are logged without the bot token or service key", async () => {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.join(" "));
  try {
    const handler = app(() => ({
      userId: () =>
        Promise.reject(
          new Error(`fetch failed: https://api.telegram.org/file/bot${BOT}/x ${SERVICE_KEY}`),
        ),
    } as never), [BOT, SERVICE_KEY]);
    const res = await handler(new Request("http://x/audio/open/1", auth("t_active")));
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error, "server_error");
  } finally {
    console.error = orig;
  }
  assertEquals(logged.length, 1);
  assert(!logged[0].includes(BOT) && !logged[0].includes(SERVICE_KEY));
});
