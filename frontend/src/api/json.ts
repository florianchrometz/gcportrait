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

export const getJson = getPublicJson;

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

export type PostJsonTokenResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly status: number;
      readonly message: string;
      readonly unauthorized?: true | undefined;
      readonly aborted?: true | undefined;
    };

/**
 * Result-oriented wrapper around `postJson` validating parsed response payload.
 */
export async function postJsonWithToken<T>(opts: {
  readonly auth: AuthControls;
  readonly path: string;
  readonly body: unknown;
  readonly signal?: AbortSignal | undefined;
  readonly label?: string | undefined;
  readonly parse: (raw: unknown) => T | null;
}): Promise<PostJsonTokenResult<T>> {
  let outcome: PostJsonOutcome;
  try {
    outcome = await postJson(opts.auth, opts.path, opts.body, opts.signal);
  } catch (error) {
    if (opts.signal?.aborted === true) {
      return { ok: false, status: 0, message: 'Cancelled.', aborted: true };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: 0, message: `Could not reach the backend (${message}).` };
  }
  if (outcome.kind === 'signed-out') {
    return { ok: false, status: 401, message: 'Sign in first.', unauthorized: true };
  }
  if (outcome.kind === 'error') {
    return { ok: false, status: 0, message: outcome.message };
  }
  const { response, body } = outcome;
  if (response.status === 401) {
    return {
      ok: false,
      status: 401,
      message: 'Your token expired or was rejected (401). Sign in again.',
      unauthorized: true,
    };
  }
  if (!response.ok) {
    const message =
      isRecord(body) && typeof body.message === 'string'
        ? body.message
        : await readErrorMessage(response, `HTTP ${String(response.status)}`);
    return { ok: false, status: response.status, message };
  }
  if (body === undefined) {
    const label = opts.label ?? opts.path;
    return {
      ok: false,
      status: response.status,
      message: `The backend returned invalid JSON from ${label}.`,
    };
  }
  const parsed = opts.parse(body);
  if (parsed === null) {
    const label = opts.label ?? opts.path;
    return {
      ok: false,
      status: response.status,
      message: `The backend returned an unexpected ${label} response.`,
    };
  }
  return { ok: true, data: parsed };
}
