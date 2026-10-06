// accounts: register, approve / reject and password reset for username + password sign-in.
// Pure logic with injected db + auth admin so tests need no network. Wiring is in index.ts.
// Public Supabase sign-ups stay OFF: this function (service role) is the only way an account
// is created, with a synthetic internal email that is never shown or mailed.
import { userIdFromJwt } from "../download-links/handler.ts";

export const EMAIL_DOMAIN = "users.hearthread.invalid";
/** Open registration is capped so a stranger cannot flood the Requests list. */
export const MAX_PENDING = 50;

const USERNAME = /^[a-z0-9_]{3,20}$/;
export const emailFor = (username: string) => `${username}@${EMAIL_DOMAIN}`;

export interface MemberRow {
  user_id: string;
  username: string | null;
  status: string;
  is_admin: boolean;
  created_at: string;
}
export interface Deps {
  member(userId: string): Promise<MemberRow | null>;
  members(): Promise<MemberRow[]>;
  pendingCount(): Promise<number>;
  /** New confirmed auth account; null when the (synthetic) email already exists. */
  createUser(email: string, password: string): Promise<string | null>;
  /** Pending member row; false when the username is already taken. */
  addMember(userId: string, email: string, username: string): Promise<boolean>;
  deleteUser(userId: string): Promise<void>;
  setStatus(userId: string, status: "active" | "revoked"): Promise<void>;
  setPassword(userId: string, password: string): Promise<void>;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const bad = (msg: string) => json(400, { error: "bad_request", message: msg });

// bcrypt (what Supabase Auth uses) ignores everything past 72 bytes.
const passwordOk = (p: unknown): p is string =>
  typeof p === "string" && p.length >= 8 && new TextEncoder().encode(p).length <= 72;

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return bad("body must be JSON");
  }

  if (body.action === "register") return await register(body, deps);

  // Everything else is admin-only: a signed-in, active member whose row says is_admin.
  const userId = userIdFromJwt(req);
  if (!userId) return json(401, { error: "unauthorized" });
  const me = await deps.member(userId);
  if (me?.status !== "active" || !me.is_admin) return json(403, { error: "forbidden" });

  switch (body.action) {
    case "list":
      return json(200, { members: await deps.members() });
    case "set_status": {
      if (body.status !== "active" && body.status !== "revoked") return bad("status invalid");
      const target = await adminTarget(body.user_id, deps);
      if (target instanceof Response) return target;
      if (target.is_admin) return json(403, { error: "forbidden" }); // an admin is never revoked here
      await deps.setStatus(target.user_id, body.status);
      return json(200, { ok: true });
    }
    case "reset_password": {
      if (!passwordOk(body.password)) return bad("password must be 8 to 72 characters");
      const target = await adminTarget(body.user_id, deps);
      if (target instanceof Response) return target;
      await deps.setPassword(target.user_id, body.password);
      return json(200, { ok: true });
    }
    default:
      return bad("unknown action");
  }
}

/** The member an admin action is about, or the refusal to send. */
async function adminTarget(id: unknown, deps: Deps): Promise<MemberRow | Response> {
  if (typeof id !== "string" || !id) return bad("user_id invalid");
  const target = await deps.member(id);
  if (!target) return json(404, { error: "not_found" });
  return target;
}

async function register(body: Record<string, unknown>, deps: Deps): Promise<Response> {
  const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
  if (!USERNAME.test(username)) {
    return bad("username must be 3 to 20 letters, digits or underscores");
  }
  if (!passwordOk(body.password)) return bad("password must be 8 to 72 characters");
  if (await deps.pendingCount() >= MAX_PENDING) return json(429, { error: "registration_full" });

  const email = emailFor(username);
  const userId = await deps.createUser(email, body.password);
  if (!userId) return json(409, { error: "username_taken" });
  if (!await deps.addMember(userId, email, username)) {
    await deps.deleteUser(userId); // no orphan auth account if the row cannot be written
    return json(409, { error: "username_taken" });
  }
  return json(200, { ok: true });
}
