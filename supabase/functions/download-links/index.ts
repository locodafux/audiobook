// Edge Function entry: wires the real database (PostgREST, service key) and Telegram.
// Secret by name: TELEGRAM_BOT_TOKEN (a Supabase function secret, never committed).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.
// The download URL contains the bot token, so nothing here logs it: Telegram errors are replaced by a
// fixed message, and anything logged has the token and service key scrubbed.
import { type BookRow, type ChapterRow, type Deps, handle } from "./handler.ts";

export const TELEGRAM_API = "https://api.telegram.org";

type Env = (name: string) => string;
const denoEnv: Env = (name) => {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
};

export function realDeps(
  env: Env = denoEnv,
  f: typeof fetch = fetch,
  telegramApi: string = TELEGRAM_API,
): Deps {
  const rest = env("SUPABASE_URL").replace(/\/+$/, "") + "/rest/v1/";
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const botToken = env("TELEGRAM_BOT_TOKEN");
  const get = async <T>(path: string): Promise<T[]> => {
    const res = await f(rest + path, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`db ${res.status}`);
    return await res.json();
  };
  const q = encodeURIComponent;
  return {
    memberStatus: async (userId) =>
      (await get<{ status: string }>(`members?user_id=eq.${q(userId)}&select=status`))[0]?.status ??
        null,
    books: (ids) =>
      get<BookRow>(
        `books?id=in.(${
          ids.map((i) => q(`"${i}"`)).join(",")
        })&select=id,status,cover_file_id,private_to`,
      ),
    chapters: (bookId, ns) =>
      get<ChapterRow>(
        `chapters?book_id=eq.${q(bookId)}&n=in.(${ns.join(",")})` +
          `&select=n,status,bytes,audio_sha256,telegram_audio_file_id,telegram_timing_file_id`,
      ),
    async telegramUrl(fileId) {
      let res: Response;
      try {
        res = await f(`${telegramApi}/bot${botToken}/getFile?file_id=${q(fileId)}`);
      } catch {
        throw new Error("telegram unreachable"); // the original error would carry the URL
      }
      // Telegram says 400 for a file it no longer has, or one over the 20 MB a bot can download.
      if (res.status === 400 || res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok) throw new Error(`telegram getFile ${res.status}`);
      const path = (await res.json())?.result?.file_path;
      if (typeof path !== "string" || !path) return null;
      return `${telegramApi}/file/bot${botToken}/${path}`;
    },
  };
}

/** The request handler with its error policy: log a scrubbed message, answer 500, never throw. */
export function app(deps: () => Deps, secrets: string[] = []) {
  let ready: Deps | undefined;
  return async (req: Request): Promise<Response> => {
    try {
      return await handle(req, ready ??= deps());
    } catch (e) {
      let msg = e instanceof Error ? e.message : "error";
      for (const s of secrets) if (s) msg = msg.replaceAll(s, "[redacted]");
      console.error(msg);
      return new Response(JSON.stringify({ error: "server_error" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
  };
}

if (import.meta.main) {
  Deno.serve(app(() => realDeps(), [
    Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  ]));
}
