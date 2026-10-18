// SPDX-License-Identifier: MIT
/**
 * Client for `POST /api/scopes/search` (backend/src/routes/scopes.ts; docs/api.md): the
 * organisations, folders and projects the signed-in person can see, matching what they typed. The token goes only
 * to this backend, through `fetchWithToken` (src/auth). The answer's contract is declared once, in
 * @gcportrait/model (`ScopeSearchResponseSchema`); its types come from there erased, and `isScopeSearchAnswer`
 * checks an answer by hand (no zod on the UI thread; AGENTS.md, Architecture and code), held to the schema by
 * api.test.ts. An answer that does not fit is an error; a result whose scope name this app does not read is
 * dropped.
 */
import type { ScopeSearchProblem, ScopeSearchResponse, ScopeSearchResult } from '@gcportrait/model';

import { fetchWithToken, NotSignedInError, type AuthControls } from '../auth';
import { isRecord } from '../guards';
import { isUpstreamSummary, readError } from '../preflight/api';
import { parseScopeName, SCOPE_KINDS, type ScopeChoice, type ScopeKind } from './scopeName';

export type { ScopeSearchProblem as SearchProblem } from '@gcportrait/model';

export interface ScopeSearchRequest {
  readonly query: string;
  readonly kinds?: readonly ScopeKind[];
  readonly pageSize?: number;
  readonly pageToken?: string;
}

export type ScopeSearchOutcome =
  | {
      readonly kind: 'ok';
      readonly scopes: readonly ScopeChoice[];
      readonly nextPageToken?: string;
      /** Kinds whose search failed; the others' results are listed. */
      readonly problems: readonly ScopeSearchProblem[];
    }
  /** No usable token, or the backend answered 401 (the session then expires: fetchWithToken). */
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'error'; readonly message: string };

function isScopeKind(value: unknown): value is ScopeKind {
  return typeof value === 'string' && (SCOPE_KINDS as readonly string[]).includes(value);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isSearchResult(value: unknown): value is ScopeSearchResult {
  return (
    isRecord(value) &&
    isScopeKind(value.kind) &&
    typeof value.scope === 'string' &&
    typeof value.id === 'string' &&
    typeof value.displayName === 'string' &&
    isOptionalString(value.parent) &&
    isOptionalString(value.projectNumber)
  );
}

function isSearchProblem(value: unknown): value is ScopeSearchProblem {
  return isRecord(value) && isScopeKind(value.kind) && isUpstreamSummary(value.upstream);
}

/** Whether a body is a search answer, field by field. */
export function isScopeSearchAnswer(value: unknown): value is ScopeSearchResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.scopes) &&
    value.scopes.every(isSearchResult) &&
    isOptionalString(value.nextPageToken) &&
    Array.isArray(value.problems) &&
    value.problems.every(isSearchProblem)
  );
}

/** One result as a ScopeChoice, or null when its scope name is not one this app reads as its kind. */
function choiceOf(result: ScopeSearchResult): ScopeChoice | null {
  const parsed = parseScopeName(result.scope);
  if (parsed === null || parsed.kind !== result.kind || parsed.scope !== result.scope) return null;
  return {
    ...parsed,
    ...(result.displayName === '' ? {} : { displayName: result.displayName }),
    ...(result.parent === undefined ? {} : { parent: result.parent }),
  };
}

/** The answer's body as an outcome, or null when it is not one. */
export function readSearchAnswer(body: unknown): Extract<ScopeSearchOutcome, { kind: 'ok' }> | null {
  if (!isScopeSearchAnswer(body)) return null;
  const scopes = body.scopes.flatMap((result) => {
    const choice = choiceOf(result);
    return choice === null ? [] : [choice];
  });
  return {
    kind: 'ok',
    scopes,
    ...(body.nextPageToken === undefined ? {} : { nextPageToken: body.nextPageToken }),
    problems: body.problems,
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
