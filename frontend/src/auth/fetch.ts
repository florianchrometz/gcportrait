// SPDX-License-Identifier: MIT
import type { AuthControls } from './context';

/**
 * The request header that carries the session's Google token to this backend (AGENTS.md, Security and privacy,
 * Tokens). Not `Authorization`: Identity-Aware Proxy in front of an instance (`deploy.sh --iap`) treats that header
 * as its own credential, so a person's token in it would never get past IAP. The backend reads this one first
 * (backend/src/stream/caller.ts, whose TOKEN_HEADER a backend test checks against this value).
 */
export const TOKEN_HEADER = 'x-gcportrait-token';

/** There is no usable token: the person is signed out, or the session expired. */
export class NotSignedInError extends Error {
  override readonly name = 'NotSignedInError';
  constructor() {
    super('Sign in with Google to continue.');
  }
}

/**
 * `fetch` to this backend's API with the session's token in {@link TOKEN_HEADER} (the backend forwards it
 * to Google and never keeps it). Only same-origin `/api/` paths are accepted, so the token
 * never goes anywhere else, and never into a URL; a caller's own `Authorization` header is dropped, so nothing
 * else IAP would take for its own goes along. The request is never cached (`no-store`), and the header is not a
 * cookie: the browser sends it only with these calls. A 401 answer tells the session that Google refused the
 * token. Throws `NotSignedInError` when there is no usable token.
 */
export async function fetchWithToken(
  auth: AuthControls,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!path.startsWith('/api/')) throw new Error(`fetchWithToken only calls this backend's /api/ paths.`);
  const accessToken = auth.accessToken();
  if (accessToken === null) throw new NotSignedInError();
  const headers = new Headers(init.headers);
  headers.delete('authorization');
  headers.set(TOKEN_HEADER, accessToken);
  const response = await fetch(path, { ...init, headers, credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 401) auth.rejected(accessToken);
  return response;
}
