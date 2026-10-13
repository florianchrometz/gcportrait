// SPDX-License-Identifier: MIT
import { createContext, useContext } from 'react';

/**
 * What the app does with the sign-in session: start it, renew it, end it, and read the token for a request. The
 * provider (AuthProvider.tsx) supplies the live session's controls, or `NO_AUTH` while there is none (demo mode,
 * no backend, no OAuth client), whose `accessToken()` is always null.
 */
export interface AuthControls {
  /** Opens Google's sign-in window; call from a click handler. */
  readonly signIn: () => void;
  /** "Stay signed in": a fresh token for the same account; call from a click handler. */
  readonly renew: () => void;
  /** Forgets the token and revokes it with Google. */
  readonly signOut: () => void;
  /**
   * The access token while it is usable, else null. Call it when a request is made (in an event handler or an
   * effect, not while rendering) and send it only to this backend, in `X-Gcportrait-Token` (fetchWithToken;
   * AGENTS.md, Security and privacy, Tokens).
   */
  readonly accessToken: () => string | null;
  /** The backend answered 401 for this token: the session expires (if the token is still the current one). */
  readonly rejected: (accessToken: string) => void;
}

export const NO_AUTH: AuthControls = {
  signIn: () => undefined,
  renew: () => undefined,
  signOut: () => undefined,
  accessToken: () => null,
  rejected: () => undefined,
};

export const AuthContext = createContext<AuthControls>(NO_AUTH);

/** The sign-in controls (src/auth). The session's state is in the app store: `useAppState((s) => s.connect)`. */
export function useAuth(): AuthControls {
  return useContext(AuthContext);
}
