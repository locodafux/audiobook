// download-links: hands a signed-in, active member direct Telegram download links.
// Pure logic with injected db + Telegram lookup so tests need no network. Wiring is in index.ts.
//
// The link is https://api.telegram.org/file/bot<token>/<path>, so the bot token travels to every
// approved member's phone. That is an accepted risk (docs/decisions.md). Telegram keeps a path valid
// for at least an hour; the app asks again for every download, so links are reported as short-lived.

export const EXPIRES_S = 1800;
export const MAX_CHAPTERS = 25;
export const MAX_BOOKS = 50;

export interface ChapterRow {
  n: number;
  status: string;
  bytes: number | null;
  audio_sha256: string | null;
  telegram_audio_file_id: string | null;
  telegram_timing_file_id: string | null;
}
export interface BookRow {
  id: string;
  status: string;
  cover_file_id: string | null;
  /** null = every active member; otherwise only that member. */
  private_to: string | null;
}
export interface Deps {
  memberStatus(userId: string): Promise<string | null>;
  books(ids: string[]): Promise<BookRow[]>;
  chapters(bookId: string, ns: number[]): Promise<ChapterRow[]>;
  /** getFile, then the direct download URL. null = Telegram no longer has that file. Throws when Telegram is unreachable. */
  telegramUrl(fileId: string): Promise<string | null>;
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const bad = (msg: string) => json(400, { error: "bad_request", message: msg });

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

/** The platform already verified the token signature; we only read who it is. */
export function userIdFromJwt(req: Request): string | null {
  const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return null;
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const sub = JSON.parse(atob(part)).sub;
    return typeof sub === "string" && sub ? sub : null; // the anon key has no sub
  } catch {
    return null;
  }
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  const userId = userIdFromJwt(req);
  if (!userId) return json(401, { error: "unauthorized" });

  let body: { book_id?: unknown; chapters?: unknown; book_ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("body must be JSON");
  }

  // Validate before touching the database.
  const wantChapters = body.book_id !== undefined || body.chapters !== undefined;
  const wantCovers = body.book_ids !== undefined;
  if (wantChapters === wantCovers) return bad("send either book_id+chapters or book_ids");

  let bookId = "";
  let ns: number[] = [];
  let bookIds: string[] = [];
  if (wantChapters) {
    const c = body.chapters;
    if (typeof body.book_id !== "string" || !ID.test(body.book_id)) return bad("book_id invalid");
    if (!Array.isArray(c) || c.length < 1 || c.length > MAX_CHAPTERS) {
      return bad(`chapters must hold 1 to ${MAX_CHAPTERS} numbers`);
    }
    if (!c.every((n) => Number.isInteger(n) && n >= 1 && n <= 1_000_000)) {
      return bad("chapters must be positive integers");
    }
    bookId = body.book_id;
    ns = [...new Set(c as number[])];
  } else {
    const b = body.book_ids;
    if (!Array.isArray(b) || b.length < 1 || b.length > MAX_BOOKS) {
      return bad(`book_ids must hold 1 to ${MAX_BOOKS} ids`);
    }
    if (!b.every((id) => typeof id === "string" && ID.test(id))) return bad("book_ids invalid");
    bookIds = [...new Set(b as string[])];
  }

  // Pending, revoked (or never invited) is refused even with a still-valid token.
  if (await deps.memberStatus(userId) !== "active") return json(403, { error: "access_ended" });

  // A private book answers exactly like a missing one, so its existence does not leak.
  const visible = (b: BookRow | undefined) =>
    b?.status === "published" && (!b.private_to || b.private_to === userId);

  try {
    return await answer();
  } catch {
    // Telegram unreachable or the database failed. Say nothing about why: errors name URLs with the token.
    return json(502, { error: "storage_unavailable" });
  }

  async function answer(): Promise<Response> {
    if (wantCovers) {
      const rows = new Map((await deps.books(bookIds)).map((r) => [r.id, r]));
      const covers = await Promise.all(bookIds.map(async (id) => {
        const r = rows.get(id);
        const url = visible(r) && r!.cover_file_id
          ? await deps.telegramUrl(r!.cover_file_id)
          : null;
        return url ? { book_id: id, url } : { book_id: id, error: "not_available" };
      }));
      return json(200, { expires_in: EXPIRES_S, covers });
    }

    const [book] = await deps.books([bookId]);
    if (!visible(book)) {
      return json(200, {
        expires_in: EXPIRES_S,
        chapters: ns.map((n) => ({ n, error: "not_available" })),
      });
    }
    const rows = new Map((await deps.chapters(bookId, ns)).map((r) => [r.n, r]));
    const chapters = await Promise.all(ns.map(async (n) => {
      const r = rows.get(n);
      if (
        !r || r.status !== "ready" || !r.telegram_audio_file_id || !r.telegram_timing_file_id
      ) {
        return { n, error: "not_available" };
      }
      const [audio_url, timing_url] = await Promise.all([
        deps.telegramUrl(r.telegram_audio_file_id),
        deps.telegramUrl(r.telegram_timing_file_id),
      ]);
      if (!audio_url || !timing_url) return { n, error: "not_available" };
      return { n, audio_url, timing_url, bytes: r.bytes, sha256: r.audio_sha256 };
    }));
    return json(200, { expires_in: EXPIRES_S, chapters });
  }
}
