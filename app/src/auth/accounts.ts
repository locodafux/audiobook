import type { SupabaseClient } from '@supabase/supabase-js';

import { AuthFlowError } from './authApi';
import { classifyAuthError, type AuthFailure } from './errors';

const named: Record<string, AuthFailure> = { username_taken: 'username_taken', registration_full: 'registration_full' };

/**
 * Calls the `accounts` function (register, and the admin's list / approve / reset). A refusal arrives as an
 * HTTP error whose body names the reason; anything else is a connection problem.
 */
export async function callAccounts<T = unknown>(client: SupabaseClient, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.functions.invoke('accounts', { body });
  if (!error) return data as T;
  const reason = await (error as { context?: { json?: () => Promise<{ error?: string }> } }).context?.json?.().catch(() => null);
  throw new AuthFlowError((reason?.error && named[reason.error]) || classifyAuthError(error));
}
