export const RELEASE_URL = 'https://api.github.com/repos/locodafux/audiobook/releases/tags/latest';

export type Update = { versionCode: number; url: string };

type Release = { assets?: { name?: unknown; browser_download_url?: unknown }[] };

/**
 * The rolling `latest` release holds one APK named `hearthread-<versionCode>.apk` (scripts/release.sh).
 * Returns it when it is newer than the installed build; null when up to date or anything goes wrong.
 */
export async function checkForUpdate(installed: number, fetchJson: (url: string) => Promise<unknown> = defaultFetch): Promise<Update | null> {
  try {
    const release = (await fetchJson(RELEASE_URL)) as Release | null;
    for (const a of release?.assets ?? []) {
      const m = typeof a.name === 'string' ? /^hearthread-(\d+)\.apk$/.exec(a.name) : null;
      if (m && typeof a.browser_download_url === 'string' && Number(m[1]) > installed) {
        return { versionCode: Number(m[1]), url: a.browser_download_url };
      }
    }
  } catch {
    // Offline or rate-limited: no banner.
  }
  return null;
}

async function defaultFetch(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`release check ${res.status}`);
  return res.json();
}
