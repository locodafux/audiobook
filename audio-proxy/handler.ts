// audio-proxy: streams one chapter's audio (or timing file) from Telegram to a signed-in,
// still-active member. Pure logic with injected lookups so tests need no network; the real
// wiring is in main.ts.
//
//   GET /audio/<book_id>/<n>    GET /timing/<book_id>/<n>     Authorization: Bearer <member token>
//
// The bot token never reaches the phone: the phone only ever talks to this function.

export interface Chapter {
  n: number;
  status: string;
  telegram_audio_file_id: string | null;
  telegram_timing_file_id: string | null;
}
export interface Book {
  id: string;
  status: string;
  /** null = every active member; otherwise only that member. */
  private_to: string | null;
}
export interface TelegramFile {
  body: ReadableStream<Uint8Array>;
  /** Total bytes, when Telegram said. Without it a Range request is answered with the whole file. */
  size: number | null;
}
export interface Deps {
  /** Who the bearer token belongs to (Supabase Auth asked), or null when it is not valid. */
  userId(token: string): Promise<string | null>;
  memberStatus(userId: string): Promise<string | null>;
  book(id: string): Promise<Book | null>;
  chapter(bookId: string, n: number): Promise<Chapter | null>;
  /** getFile then fetch. null = Telegram no longer has that file. Throws when Telegram is unreachable. */
  telegramFile(fileId: string): Promise<TelegramFile | null>;
}

const json = (status: number, body: unknown, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const ROUTE = /^\/(audio|timing)\/([^/]+)\/(\d{1,7})$/;

export type ByteRange = { start: number; end: number }; // end inclusive

/**
 * One `bytes=` range against a file of `size` bytes. null = no usable Range header (send it all);
 * "unsatisfiable" = well-formed but outside the file (416). Multi-range and odd syntax are
 * ignored, which RFC 9110 allows.
 */
export function parseRange(
  header: string | null,
  size: number,
): ByteRange | "unsatisfiable" | null {
  const m = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") { // suffix: the last n bytes
    const n = Number(m[2]);
    return n === 0 || size === 0
      ? "unsatisfiable"
      : { start: Math.max(0, size - n), end: size - 1 };
  }
  const start = Number(m[1]);
  const end = m[2] === "" ? size - 1 : Number(m[2]);
  if (start >= size) return "unsatisfiable";
  if (end < start) return null;
  return { start, end: Math.min(end, size - 1) };
}

/** Passes through bytes start..end (inclusive) and stops, which also cancels the upstream read. */
function slice(start: number, end: number) {
  let pos = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      const from = Math.max(start - pos, 0);
      const to = Math.min(end + 1 - pos, chunk.length);
      if (to > from) ctl.enqueue(chunk.subarray(from, to));
      pos += chunk.length;
      if (pos > end) ctl.terminate();
    },
  });
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" }, { allow: "GET" });
  const route = new URL(req.url).pathname.match(ROUTE);
  if (!route || !ID.test(route[2])) return json(404, { error: "not_found" });
  const [, kind, bookId, nText] = route;
  const n = Number(nText);
  if (n < 1) return json(404, { error: "not_found" });

  const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return json(401, { error: "unauthorized" });
  const userId = await deps.userId(token);
  if (!userId) return json(401, { error: "unauthorized" });
  // Anything but active (revoked, pending, rejected, never invited) is refused even with a valid token.
  if (await deps.memberStatus(userId) !== "active") return json(403, { error: "access_ended" });

  const [book, chapter] = await Promise.all([deps.book(bookId), deps.chapter(bookId, n)]);
  const fileId = kind === "audio"
    ? chapter?.telegram_audio_file_id
    : chapter?.telegram_timing_file_id;
  // A private book answers exactly like a missing one, so its existence does not leak.
  const visible = book?.status === "published" && (!book.private_to || book.private_to === userId);
  if (!visible || chapter?.status !== "ready" || !fileId) {
    return json(404, { error: "not_available" });
  }

  let file: TelegramFile | null;
  try {
    file = await deps.telegramFile(fileId);
  } catch {
    return json(502, { error: "storage_unavailable" });
  }
  if (!file) return json(404, { error: "not_available" });

  const headers: Record<string, string> = {
    "content-type": kind === "audio" ? "audio/mpeg" : "application/json",
    "accept-ranges": "bytes",
    // the phone keeps its own copy; nothing in between should
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
  // ponytail: Telegram's file server may ignore Range, so the whole file is read and sliced here.
  // Chapters are at most 20 MB and only this function's outgoing bytes are metered; forward Range
  // upstream if that ever matters.
  const range = file.size === null ? null : parseRange(req.headers.get("range"), file.size);
  if (range === "unsatisfiable") {
    await file.body.cancel();
    return json(416, { error: "range_not_satisfiable" }, {
      "content-range": `bytes */${file.size}`,
    });
  }
  if (range) {
    return new Response(file.body.pipeThrough(slice(range.start, range.end)), {
      status: 206,
      headers: {
        ...headers,
        "content-length": String(range.end - range.start + 1),
        "content-range": `bytes ${range.start}-${range.end}/${file.size}`,
      },
    });
  }
  if (file.size !== null) headers["content-length"] = String(file.size);
  return new Response(file.body, { status: 200, headers });
}
