/** What the sign-in screens care about, whatever Supabase called the error. */
export type AuthFailure = 'not_invited' | 'expired' | 'invalid' | 'rate_limited' | 'offline' | 'banned' | 'unknown';

type ErrorLike = { code?: string; message?: string; name?: string; status?: number };

/**
 * Maps a supabase-js auth error onto AuthFailure.
 * ponytail: the exact code GoTrue returns for a stranger with sign-ups disabled is
 * confirmed in the plan's phase-1 spike; `otp_disabled` / `signup_disabled` and the
 * message are the known candidates, so all of them map to "not on the invite list".
 */
export function classifyAuthError(error: unknown): AuthFailure {
  const e = (typeof error === 'object' && error !== null ? error : {}) as ErrorLike;
  const message = e.message ?? '';
  switch (e.code) {
    case 'otp_disabled':
    case 'signup_disabled':
    case 'user_not_found':
      return 'not_invited';
    case 'otp_expired':
      return 'expired';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'rate_limited';
    case 'user_banned':
      return 'banned';
    case 'validation_failed':
    case 'bad_code_verifier':
    case 'flow_state_not_found':
    case 'flow_state_expired':
      return 'invalid';
  }
  if (/signups? not allowed/i.test(message)) return 'not_invited';
  if (/expired/i.test(message)) return 'expired';
  if (
    e.name === 'AuthRetryableFetchError' ||
    e.status === 0 ||
    /network request failed|failed to fetch|network error/i.test(message)
  ) {
    return 'offline';
  }
  if (e.status === 429) return 'rate_limited';
  return 'unknown';
}
