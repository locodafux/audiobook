import { assertEquals } from "@std/assert";
import { type Deps, emailFor, handle, MAX_PENDING, type MemberRow } from "./handler.ts";

const jwt = (sub?: string) => `h.${btoa(JSON.stringify(sub ? { sub } : { role: "anon" }))}.s`;
const call = (body: unknown, token = jwt()) =>
  new Request("http://x/", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
const row = (user_id: string, status: string, is_admin = false): MemberRow => ({
  user_id,
  username: user_id,
  status,
  is_admin,
  created_at: "2026-10-06T00:00:00Z",
});

function fake(rows: MemberRow[] = [], over: Partial<Deps> = {}) {
  const members = new Map(rows.map((r) => [r.user_id, r]));
  const log: string[] = [];
  const deps: Deps = {
    member: (id) => Promise.resolve(members.get(id) ?? null),
    members: () => Promise.resolve([...members.values()]),
    pendingCount: () =>
      Promise.resolve([...members.values()].filter((m) => m.status === "pending").length),
    createUser: (email) => {
      log.push(`createUser:${email}`);
      return Promise.resolve(email.startsWith("taken@") ? null : "new-id");
    },
    addMember: (id, email, username) => {
      log.push(`addMember:${id}:${email}:${username}`);
      return Promise.resolve(username !== "race");
    },
    deleteUser: (id) => {
      log.push(`deleteUser:${id}`);
      return Promise.resolve();
    },
    setStatus: (id, status) => {
      log.push(`setStatus:${id}:${status}`);
      return Promise.resolve();
    },
    setPassword: (id) => {
      log.push(`setPassword:${id}`);
      return Promise.resolve();
    },
    ...over,
  };
  return { deps, log };
}

const register = (username: unknown, password: unknown = "longenough1") =>
  call({ action: "register", username, password });

Deno.test("register creates a confirmed account with the synthetic email and a pending row", async () => {
  const { deps, log } = fake();
  const res = await handle(register("  Maria_7 "), deps);
  assertEquals(res.status, 200);
  assertEquals(log, [
    `createUser:${emailFor("maria_7")}`,
    `addMember:new-id:${emailFor("maria_7")}:maria_7`,
  ]);
});

Deno.test("register works with only the anon key (no signed-in user)", async () => {
  assertEquals((await handle(register("maria"), fake().deps)).status, 200);
});

Deno.test("register refuses bad usernames and short or oversized passwords before touching anything", async () => {
  for (const u of ["ab", "has space", "UPPER-dash", "a".repeat(21), "x@y.co", 7, undefined]) {
    const { deps, log } = fake();
    assertEquals((await handle(register(u), deps)).status, 400, String(u));
    assertEquals(log, []);
  }
  for (const p of ["short7!", "é".repeat(37), null, 12345678]) {
    const { deps, log } = fake();
    assertEquals((await handle(register("maria", p), deps)).status, 400, String(p));
    assertEquals(log, []);
  }
});

Deno.test("register reports a taken username, including a lost race (no orphan account)", async () => {
  const taken = await handle(register("taken"), fake().deps);
  assertEquals(taken.status, 409);
  assertEquals((await taken.json()).error, "username_taken");

  const { deps, log } = fake();
  assertEquals((await handle(register("race"), deps)).status, 409);
  assertEquals(log.at(-1), "deleteUser:new-id");
});

Deno.test("register stops when too many requests are waiting", async () => {
  const rows = Array.from({ length: MAX_PENDING }, (_, i) => row(`p${i}`, "pending"));
  const { deps, log } = fake(rows);
  const res = await handle(register("maria"), deps);
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error, "registration_full");
  assertEquals(log, []);
});

const admin = row("admin", "active", true);
const asAdmin = (body: unknown) => call(body, jwt("admin"));

Deno.test("admin actions need a signed-in active admin", async () => {
  const rows = [admin, row("friend", "active"), row("waiting", "pending"), row("gone", "revoked")];
  const cases: [string, string][] = [
    [jwt(), "anon key"],
    [jwt("friend"), "active non-admin"],
    [jwt("waiting"), "pending member"],
    [jwt("gone"), "revoked member"],
    [jwt("stranger"), "no member row"],
  ];
  for (const [token, who] of cases) {
    for (
      const body of [
        { action: "list" },
        { action: "set_status", user_id: "waiting", status: "active" },
        { action: "reset_password", user_id: "friend", password: "newpassword1" },
      ]
    ) {
      const { deps, log } = fake(rows);
      const res = await handle(call(body, token), deps);
      assertEquals(res.status, token === jwt() ? 401 : 403, `${who}: ${body.action}`);
      assertEquals(log, [], who);
    }
  }
});

Deno.test("an admin that is no longer active loses admin powers", async () => {
  const { deps } = fake([row("admin", "revoked", true)]);
  assertEquals((await handle(asAdmin({ action: "list" }), deps)).status, 403);
});

Deno.test("admin lists members and approves a pending one", async () => {
  const { deps, log } = fake([admin, row("waiting", "pending")]);
  const list = await (await handle(asAdmin({ action: "list" }), deps)).json();
  assertEquals(list.members.map((m: MemberRow) => m.user_id), ["admin", "waiting"]);
  const res = await handle(
    asAdmin({ action: "set_status", user_id: "waiting", status: "active" }),
    deps,
  );
  assertEquals(res.status, 200);
  assertEquals(log, ["setStatus:waiting:active"]);
});

Deno.test("admin rejects, can undo, and cannot revoke an admin or set a weird status", async () => {
  const { deps, log } = fake([admin, row("waiting", "pending")]);
  await handle(asAdmin({ action: "set_status", user_id: "waiting", status: "revoked" }), deps);
  assertEquals(log, ["setStatus:waiting:revoked"]);
  assertEquals(
    (await handle(asAdmin({ action: "set_status", user_id: "admin", status: "revoked" }), deps))
      .status,
    403,
  );
  assertEquals(
    (await handle(asAdmin({ action: "set_status", user_id: "waiting", status: "pending" }), deps))
      .status,
    400,
  );
  assertEquals(
    (await handle(asAdmin({ action: "set_status", user_id: "nobody", status: "active" }), deps))
      .status,
    404,
  );
  assertEquals(log.length, 1);
});

Deno.test("admin resets a password; a short one or unknown member is refused", async () => {
  const { deps, log } = fake([admin, row("friend", "active")]);
  const ok = await handle(
    asAdmin({ action: "reset_password", user_id: "friend", password: "brandnew-pass" }),
    deps,
  );
  assertEquals(ok.status, 200);
  assertEquals(log, ["setPassword:friend"]);
  assertEquals(
    (await handle(
      asAdmin({ action: "reset_password", user_id: "friend", password: "short" }),
      deps,
    ))
      .status,
    400,
  );
  assertEquals(
    (await handle(
      asAdmin({ action: "reset_password", user_id: "nobody", password: "brandnew-pass" }),
      deps,
    )).status,
    404,
  );
  assertEquals(log.length, 1);
});

Deno.test("only POST with a JSON body and a known action", async () => {
  const { deps } = fake([admin]);
  assertEquals((await handle(new Request("http://x/"), deps)).status, 405);
  const notJson = new Request("http://x/", { method: "POST", body: "nope" });
  assertEquals((await handle(notJson, deps)).status, 400);
  assertEquals((await handle(asAdmin({ action: "nope" }), deps)).status, 400);
});
