// Deno Deploy entry: wires the real Supabase lookups and Telegram, and serves handler.ts.
// Secrets by name (Deno Deploy project settings, never in the repo):
//   TELEGRAM_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Nothing here may log the bot token or a Telegram file URL (the URL contains the token), so
// every Telegram call drops the original error, whose message would carry that URL.
import { type Book, type Chapter, type Deps, handle, type TelegramFile } from "./handler.ts";

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
  const supabase = env("SUPABASE_URL").replace(/\/+$/, "");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const botToken = env("TELEGRAM_BOT_TOKEN");
  const q = encodeURIComponent;

  const rest = async <T>(path: string): Promise<T[]> => {
    const res = await f(`${supabase}/rest/v1/${path}`, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    if (!res.ok) throw new Error(`database ${res.status}`);
    return await res.json();
  };

  // Never let the underlying error (whose message names the URL) escape.
  const telegram = async (url: string): Promise<Response> => {
    try {
      return await f(url);
    } catch {
      throw new Error("telegram unreachable");
    }
  };

  return {
    async userId(token) {
      const res = await f(`${supabase}/auth/v1/user`, {
        headers: { apikey: key, authorization: `Bearer ${token}` },
      });
      if (res.status >= 500) throw new Error(`auth ${res.status}`);
      if (!res.ok) return null;
      const id = (await res.json())?.id;
      return typeof id === "string" && id ? id : null;
    },
    memberStatus: async (userId) =>
      (await rest<{ status: string }>(`members?user_id=eq.${q(userId)}&select=status`))[0]
        ?.status ?? null,
    book: async (id) =>
      (await rest<Book>(`books?id=eq.${q(id)}&select=id,status,private_to`))[0] ?? null,
    chapter: async (bookId, n) =>
      (await rest<Chapter>(
        `chapters?book_id=eq.${q(bookId)}&n=eq.${n}` +
          `&select=n,status,telegram_audio_file_id,telegram_timing_file_id`,
      ))[0] ?? null,
    async telegramFile(fileId): Promise<TelegramFile | null> {
      const info = await telegram(`${telegramApi}/bot${botToken}/getFile?file_id=${q(fileId)}`);
      if (info.status === 400 || info.status === 404) {
        await info.body?.cancel();
        return null; // Telegram says it has no such file (or it is over 20 MB)
      }
      if (!info.ok) throw new Error(`telegram getFile ${info.status}`);
      const meta = (await info.json())?.result;
      if (typeof meta?.file_path !== "string") return null;
      const res = await telegram(`${telegramApi}/file/bot${botToken}/${meta.file_path}`);
      if (res.status === 404) {
        await res.body?.cancel();
        return null;
      }
      if (!res.ok || !res.body) throw new Error(`telegram download ${res.status}`);
      const size = Number(res.headers.get("content-length")) || Number(meta.file_size) || null;
      return { body: res.body, size };
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
