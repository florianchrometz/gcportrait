// SPDX-License-Identifier: MIT
/**
 * Client for `POST /api/scopes/search` (backend/src/routes/scopes.ts; docs/api.md): the
 * organisations, folders and projects the signed-in person can see, matching what they typed. The token goes only
 * to this backend, through `fetchWithToken` (src/auth). The answer is checked by hand (no zod on the UI
 * thread; AGENTS.md, Architecture and code); an entry that does not fit is dropped, an answer that does not fit is an
 * error.
 */
import { fetchWithToken, NotSignedInError, type AuthControls } from '../auth';
import { isRecord } from '../guards';
import { readError, type UpstreamSummary } from '../preflight/api';
import { parseScopeName, SCOPE_KINDS, type ScopeChoice, type ScopeKind } from './scopeName';

export interface ScopeSearchRequest {
  readonly query: string;
  readonly kinds?: readonly ScopeKind[];
  readonly pageSize?: number;
  readonly pageToken?: string;
}

export interface SearchProblem {
  readonly kind: ScopeKind;
  readonly upstream: UpstreamSummary;
}

export type ScopeSearchOutcome =
  | {
      readonly kind: 'ok';
      readonly scopes: readonly ScopeChoice[];
      readonly nextPageToken?: string;
      /** Kinds whose search failed; the others' results are listed. */
      readonly problems: readonly SearchProblem[];
    }
  /** No usable token, or the backend answered 401 (the session then expires: fetchWithToken). */
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'error'; readonly message: string };

function isScopeKind(value: unknown): value is ScopeKind {
  return typeof value === 'string' && (SCOPE_KINDS as readonly string[]).includes(value);
}

/** One result as a ScopeChoice, or null when it does not fit. */
export function choiceOf(value: unknown): ScopeChoice | null {
  if (!isRecord(value) || !isScopeKind(value.kind) || typeof value.scope !== 'string') return null;
  const parsed = parseScopeName(value.scope);
  if (parsed === null || parsed.kind !== value.kind || parsed.scope !== value.scope) return null;
  return {
    ...parsed,
    ...(typeof value.displayName === 'string' && value.displayName !== ''
      ? { displayName: value.displayName }
      : {}),
    ...(typeof value.parent === 'string' ? { parent: value.parent } : {}),
  };
}

function summaryOf(value: unknown): UpstreamSummary | null {
  if (!isRecord(value) || typeof value.status !== 'number') return null;
  return {
    status: value.status,
    ...(typeof value.code === 'string' ? { code: value.code } : {}),
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
  };
}

/** The answer's body as an outcome, or null when it is not one. */
export function readSearchAnswer(body: unknown): Extract<ScopeSearchOutcome, { kind: 'ok' }> | null {
  if (!isRecord(body) || !Array.isArray(body.scopes) || !Array.isArray(body.problems)) return null;
  const scopes = body.scopes.flatMap((entry) => {
    const choice = choiceOf(entry);
    return choice === null ? [] : [choice];
  });
  const problems = body.problems.flatMap((entry) => {
    if (!isRecord(entry) || !isScopeKind(entry.kind)) return [];
    const upstream = summaryOf(entry.upstream);
    return upstream === null ? [] : [{ kind: entry.kind, upstream }];
  });
  return {
    kind: 'ok',
    scopes,
    ...(typeof body.nextPageToken === 'string' ? { nextPageToken: body.nextPageToken } : {}),
    problems,
  };
}

export async function searchScopes(
  auth: AuthControls,
  request: ScopeSearchRequest,
  signal?: AbortSignal,
): Promise<ScopeSearchOutcome> {
  let response: Response;
  try {
    response = await fetchWithToken(auth, '/api/scopes/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(request),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    if (error instanceof NotSignedInError) return { kind: 'signed-out' };
    if (signal?.aborted === true) throw error;
    return { kind: 'error', message: 'The backend did not answer. Check your connection and try again.' };
  }
  if (response.status === 401) return { kind: 'signed-out' };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) return { kind: 'error', message: readError(response.status, body) };
  return (
    readSearchAnswer(body) ?? {
      kind: 'error',
      message: 'The backend answered the search in a way this page does not understand.',
    }
  );
}
