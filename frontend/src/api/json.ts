// SPDX-License-Identifier: Apache-2.0
/**
 * Shared helpers for /api/* JSON callers (AGENTS.md, docs/api.md): unauthenticated GETs, authenticated POSTs,
 * error bodies and nullable-string guards.
 */
import { fetchWithToken, NotSignedInError, type AuthControls } from '../auth';
import { isRecord } from '../guards';

/** Whether a value is null or text (used by public config and legal text guards). */
export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/**
 * Reads `{ message: string }` from an error response JSON body, or falls back to
 * `fallback ?? \`HTTP \${String(res.status)}\``.
 */
export async function readErrorMessage(res: Response, fallback?: string): Promise<string> {
  try {
    const body: unknown = await res.json();
    if (isRecord(body) && typeof body.message === 'string') return body.message;
  } catch {
    // Non-JSON body or consumed stream.
  }
  return fallback ?? `HTTP ${String(res.status)}`;
}

/** A sentence for an error answer of this backend (`{ statusCode, error, message, requestId, code }`). */
export function readError(status: number, body: unknown): string {
  if (status === 429) return 'Too many requests for this sign-in. Wait a minute, then try again.';
  const message = isRecord(body) && typeof body.message === 'string' ? body.message : null;
  if (status >= 500 || message === null)
    return `The backend could not answer (HTTP ${String(status)}). Try again.`;
  return message;
}

/**
 * Unauthenticated GET to an `/api/*` path (e.g. `/api/config`, `/api/legal`). Returns `null` on non-2xx status,
 * network failure, or when `validate` rejects the JSON body.
 */
export async function getPublicJson<T>(
  path: string,
  validate: ((raw: unknown) => raw is T) | ((raw: unknown) => T | null),
  signal?: AbortSignal,
): Promise<T | null> {
  try {
    const response = await fetch(path, {
      headers: { accept: 'application/json' },
      credentials: 'omit',
      cache: 'no-store',
      ...(signal === undefined ? {} : { signal }),
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    const result = validate(body);
    if (typeof result === 'boolean') {
      return result ? (body as T) : null;
    }
    return result;
  } catch {
    return null;
  }
}

export type PostJsonOutcome =
  | { readonly kind: 'response'; readonly response: Response; readonly body: unknown }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Authenticated POST to an `/api/*` path with the session token. Handles signed-out sessions, 401s, network
 * failures, and lenient JSON parsing. Propagates aborts.
 */
export async function postJson(
  auth: AuthControls,
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<PostJsonOutcome> {
  let response: Response;
  try {
    response = await fetchWithToken(auth, path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (error instanceof NotSignedInError) return { kind: 'signed-out' };
    if (signal?.aborted === true) throw error;
    return { kind: 'error', message: 'The backend did not answer. Check your connection and try again.' };
  }
  if (response.status === 401) return { kind: 'signed-out' };
  let parsedBody: unknown;
  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = undefined;
  }
  return { kind: 'response', response, body: parsedBody };
}
