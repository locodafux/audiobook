/** Same domain as supabase/functions/accounts: the address behind a username, never shown or mailed. */
export const EMAIL_DOMAIN = 'users.hearthread.invalid';
export const MIN_PASSWORD = 8;

export const normalizeUsername = (raw: string) => raw.trim().toLowerCase();
export const isValidUsername = (username: string) => /^[a-z0-9_]{3,20}$/.test(username);
export const emailFor = (username: string) => `${username}@${EMAIL_DOMAIN}`;
/** The username a stored session belongs to (its auth email is `<username>@<EMAIL_DOMAIN>`). */
export const usernameFrom = (email: string) => email.split('@')[0] ?? email;

export type FormError = 'username_invalid' | 'password_short' | 'password_mismatch';

/** Checks the form before anything is sent; `confirm` is null on the log in form. */
export function validateForm(username: string, password: string, confirm: string | null): FormError | null {
  if (!isValidUsername(username)) return 'username_invalid';
  if (confirm === null) return null; // log in: the server judges the password
  if (password.length < MIN_PASSWORD) return 'password_short';
  return confirm === password ? null : 'password_mismatch';
}
