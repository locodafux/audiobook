/** What the sign-in screens care about, whatever the server called the error. */
export type AuthFailure = 'invalid_login' | 'username_taken' | 'registration_full' | 'rate_limited' | 'offline' | 'banned' | 'unknown';

type ErrorLike = { code?: string; message?: string; name?: string; status?: number };

/** Maps a supabase-js auth error onto AuthFailure. */
export function classifyAuthError(error: unknown): AuthFailure {
  const e = (typeof error === 'object' && error !== null ? error : {}) as ErrorLike;
  const message = e.message ?? '';
  switch (e.code) {
    case 'invalid_credentials':
    case 'user_not_found':
      return 'invalid_login';
    case 'over_request_rate_limit':
      return 'rate_limited';
    case 'user_banned':
      return 'banned';
  }
  if (
    e.name === 'AuthRetryableFetchError' ||
    e.name === 'FunctionsFetchError' ||
    e.status === 0 ||
    /network request failed|failed to fetch|network error/i.test(message)
  ) {
    return 'offline';
  }
  if (e.status === 429) return 'rate_limited';
  return 'unknown';
}
