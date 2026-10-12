// SPDX-License-Identifier: MIT
/**
 * The sign-in session as the rest of the app sees it: plain data in the app store's `connect` slice
 * (state/slices.ts), never the access token itself. The token lives only inside the session controller
 * (session.ts), in memory, and is handed out on request through `useAuth().accessToken()` (AuthProvider.tsx).
 */
import type { PublicConfig } from '../api/config';

/**
 * How Cloud Asset Inventory is read: `user` with the person's own token (the default), `sa` through the instance's
 * service account when the backend offers service-account mode (ADR 0004, ADR 0028 §4).
 */
export type AccessMode = 'user' | 'sa';

/** What GET /api/config said: `demo` (never asked), `loading`, `ready` with the answer, or `unavailable`. */
export type BackendState =
  | { readonly status: 'demo' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly config: PublicConfig }
  | { readonly status: 'unavailable' };

/**
 * - `unavailable`: no sign-in on this page (demo mode, the backend did not answer, or it names no OAuth client);
 * - `signed-out`; `signing-in` (the Google window is open, or the account is being read);
 * - `signed-in`: a token is held in memory until `expiresAt`;
 * - `expired`: the token ended (or Google refused it) and was dropped; `account` says who was signed in.
 */
export type SessionStatus = 'unavailable' | 'signed-out' | 'signing-in' | 'signed-in' | 'expired';

/** Renewal of a signed-in session: `renewing` (a silent re-request is under way), `needed` (it failed). */
export type RenewalState = 'idle' | 'renewing' | 'needed';

export interface SessionAccount {
  /** The Google account's email address, from Google's tokeninfo; null when Google did not say. */
  readonly email: string | null;
}

/** Why the last sign-in or renewal did not work, in words for the screen. */
export interface SessionProblem {
  readonly kind: 'popup-blocked' | 'popup-closed' | 'denied' | 'scopes' | 'load-failed' | 'account' | 'other';
  readonly message: string;
}

export interface SessionState {
  readonly status: SessionStatus;
  /** Signed in, expired, or signing in again after an expiry: who. Otherwise null. */
  readonly account: SessionAccount | null;
  /** Signed in: when the token ends (milliseconds since the epoch). Otherwise null. */
  readonly expiresAt: number | null;
  readonly renewal: RenewalState;
  readonly problem: SessionProblem | null;
  /** A one-off remark after a sign-out (Google did not confirm the revocation); otherwise null. */
  readonly notice: string | null;
}

export const UNAVAILABLE_SESSION: SessionState = {
  status: 'unavailable',
  account: null,
  expiresAt: null,
  renewal: 'idle',
  problem: null,
  notice: null,
};

export const SIGNED_OUT_SESSION: SessionState = { ...UNAVAILABLE_SESSION, status: 'signed-out' };

/**
 * Whether `next` (the session after `before`) signs in another account than `last`, the account last signed in
 * (null before the first sign-in), whatever came between: an expiry or a sign-out. Signing in again with an
 * account whose email Google did not say counts as another. A renewal (`before` signed in too) keeps its account
 * unless Google names a different one.
 */
export function anotherAccount(
  last: SessionAccount | null,
  before: SessionState,
  next: SessionState,
): boolean {
  if (next.status !== 'signed-in' || last === null) return false;
  const email = next.account?.email ?? null;
  return email !== last.email || (email === null && before.status !== 'signed-in');
}
