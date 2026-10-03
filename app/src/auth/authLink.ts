export type AuthLink =
  | { type: 'code'; code: string }
  | { type: 'error'; reason: 'expired' | 'invalid' };

/**
 * Reads the link the email opens, `hearthread://auth?code=...` (PKCE), or the
 * error form `hearthread://auth?error=access_denied&error_code=otp_expired`.
 * Returns null for anything that is not an auth link.
 */
export function parseAuthLink(url: string | null | undefined): AuthLink | null {
  if (!url) return null;
  const match = /^hearthread:\/\/auth\/?(?:[?#](.*))?$/i.exec(url.trim());
  if (!match) return null;
  const params = new URLSearchParams(match[1] ?? '');
  const code = params.get('code');
  if (code) return { type: 'code', code };
  if (params.get('error') || params.get('error_code')) {
    return { type: 'error', reason: params.get('error_code') === 'otp_expired' ? 'expired' : 'invalid' };
  }
  return null;
}
