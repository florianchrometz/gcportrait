// SPDX-License-Identifier: MIT
/**
 * Google's tokeninfo endpoint, asked once per new token: whose token it is (the `email` scope makes Google say),
 * and whether it was issued to this instance's OAuth client. The token travels in a form body, never in the URL
 * (agents.md, Security and privacy, principle 2), straight from the browser to `oauth2.googleapis.com`, the one
 * Google API host the Content Security Policy lets the browser reach; no cookie and no referrer go with it. How long
 * the lookup may take is the session's choice (`ACCOUNT_LOOKUP_TIMEOUT_MS` in session.ts, through the signal).
 */

export const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

export interface TokenInfo {
  /** The OAuth client the token was issued to (`aud`, or `azp` when Google gives only that). */
  readonly audience: string | null;
  readonly email: string | null;
}

/** Google answered tokeninfo with a 4xx: it does not accept the token at all (session.ts refuses it). */
export class TokenRefusedError extends Error {
  override readonly name = 'TokenRefusedError';
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/** Reads tokeninfo's answer for `accessToken`. Rejects on a network failure or a non-200 answer. */
export async function fetchTokenInfo(accessToken: string, signal?: AbortSignal): Promise<TokenInfo> {
  const response = await fetch(TOKENINFO_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: accessToken }).toString(),
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'no-store',
    signal: signal ?? null,
  });
  if (response.status >= 400 && response.status < 500) {
    throw new TokenRefusedError(`Google's tokeninfo refused the token (${String(response.status)}).`);
  }
  if (!response.ok) throw new Error(`Google's tokeninfo answered ${String(response.status)}.`);
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null) throw new Error("Google's tokeninfo answered no object.");
  const record = body as Record<string, unknown>;
  return { audience: text(record.aud) ?? text(record.azp), email: text(record.email) };
}
