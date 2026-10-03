// Edge Function entry: wires the real database (PostgREST, service key) and R2 signer.
// Secrets by name: R2_ACCOUNT_ID, R2_BUCKET, R2_READ_KEY_ID, R2_READ_SECRET
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform).
import { AwsClient } from "aws4fetch";
import { type BookRow, type ChapterRow, type Deps, EXPIRES_S, handle } from "./handler.ts";

const env = (name: string) => {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`missing env ${name}`);
  return v;
};

export function r2Signer(account: string, bucket: string, keyId: string, secret: string) {
  const aws = new AwsClient({
    accessKeyId: keyId,
    secretAccessKey: secret,
    service: "s3",
    region: "auto",
  });
  const base = `https://${account}.r2.cloudflarestorage.com/${bucket}/`;
  return async (key: string) => {
    const path = key.split("/").map(encodeURIComponent).join("/");
    const url = new URL(base + path);
    url.searchParams.set("X-Amz-Expires", String(EXPIRES_S));
    const signed = await aws.sign(new Request(url), { aws: { signQuery: true } });
    return signed.url;
  };
}

function realDeps(): Deps {
  const rest = env("SUPABASE_URL") + "/rest/v1/";
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const get = async <T>(path: string): Promise<T[]> => {
    const res = await fetch(rest + path, {
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
        `books?id=in.(${ids.map((i) => q(`"${i}"`)).join(",")})&select=id,status,cover_key`,
      ),
    chapters: (bookId, ns) =>
      get<ChapterRow>(
        `chapters?book_id=eq.${q(bookId)}&n=in.(${ns.join(",")})` +
          `&select=n,status,bytes,audio_sha256,audio_key,timing_key`,
      ),
    sign: r2Signer(
      env("R2_ACCOUNT_ID"),
      env("R2_BUCKET"),
      env("R2_READ_KEY_ID"),
      env("R2_READ_SECRET"),
    ),
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
