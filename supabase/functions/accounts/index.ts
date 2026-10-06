// Edge Function entry: wires the real database (PostgREST) and the Auth admin API (service key).
// No secrets of its own: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
import { type Deps, handle, type MemberRow } from "./handler.ts";

const env = (name: string) => {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
};

function realDeps(): Deps {
  const base = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const headers = {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json",
  };
  const call = (path: string, method: string, body?: unknown, extra: HeadersInit = {}) =>
    fetch(base + path, {
      method,
      headers: { ...headers, ...extra },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const ok = (res: Response) => {
    if (!res.ok) throw new Error(`${res.url} ${res.status}`);
    return res;
  };
  const cols = "user_id,username,status,is_admin,created_at";
  const q = encodeURIComponent;
  return {
    member: async (id) =>
      (await (await ok(await call(`/rest/v1/members?user_id=eq.${q(id)}&select=${cols}`, "GET")))
        .json() as MemberRow[])[0] ?? null,
    members: async () =>
      await (await ok(await call(`/rest/v1/members?select=${cols}&order=created_at`, "GET")))
        .json(),
    pendingCount: async () => {
      const res = await ok(
        await call("/rest/v1/members?status=eq.pending&select=user_id", "HEAD", undefined, {
          prefer: "count=exact",
        }),
      );
      return Number(res.headers.get("content-range")?.split("/")[1] ?? 0);
    },
    createUser: async (email, password) => {
      const res = await call("/auth/v1/admin/users", "POST", {
        email,
        password,
        email_confirm: true,
      });
      if (res.status === 422) return null; // email_exists
      return (await (await ok(res)).json()).id;
    },
    addMember: async (userId, email, username) => {
      const res = await call("/rest/v1/members", "POST", {
        user_id: userId,
        email,
        username,
        display_name: username,
        status: "pending",
      });
      if (res.status === 409) return false; // unique violation
      await ok(res);
      return true;
    },
    deleteUser: async (id) => {
      await ok(await call(`/auth/v1/admin/users/${q(id)}`, "DELETE"));
    },
    setStatus: async (id, status) => {
      await ok(
        await call(`/rest/v1/members?user_id=eq.${q(id)}`, "PATCH", {
          status,
          revoked_at: status === "revoked" ? new Date().toISOString() : null,
        }),
      );
    },
    setPassword: async (id, password) => {
      await ok(await call(`/auth/v1/admin/users/${q(id)}`, "PUT", { password }));
    },
  };
}

if (import.meta.main) {
  let deps: Deps | undefined;
  Deno.serve(async (req) => {
    try {
      return await handle(req, deps ??= realDeps());
    } catch (e) {
      console.error(e);
      return new Response(JSON.stringify({ error: "server_error" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  });
}
