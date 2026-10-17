// SPDX-License-Identifier: MIT
/**
 * Client for `POST /api/preflight` (docs/api.md, docs/permissions.md). The answer's shape is the
 * backend's `PreflightResponseSchema` (backend/src/preflight/schemas.ts), read here with plain guards because the UI
 * thread ships no zod: every field is checked, and an answer that does not fit is an error, never half
 * shown. The token goes only to this backend, through `fetchWithToken` (src/auth).
 */
import { fetchWithToken, NotSignedInError, type AuthControls } from '../auth';
import { SCOPE_KINDS, type ScopeKind } from '../scope/scopeName';

export type AccessMode = 'user' | 'sa';
export type ItemStatus = 'ok' | 'missing' | 'unknown';
export type PreflightItemId =
  'scope-details' | 'quota-project' | 'cai-access' | 'sa-caller' | 'sa-exposure' | 'sa-access';
export type Finding =
  | 'ok'
  | 'denied'
  | 'exposed'
  | 'no-candidate'
  | 'unusable'
  | 'not-checked'
  | 'no-credentials'
  | 'sign-in'
  | 'transient'
  | 'unexpected';
export type CandidateResult =
  'usable' | 'not-found' | 'no-permission' | 'api-disabled' | 'sign-in' | 'transient' | 'unexpected';
export type PreflightOutcome = 'ready' | 'blocked' | 'sign-in' | 'retry';

/** What Google answered, as the backend passes it on: status (0: no answer), canonical code, reason, message. */
export interface UpstreamSummary {
  readonly status: number;
  readonly code?: string;
  readonly reason?: string;
  readonly message?: string;
}

export interface PreflightItem {
  readonly id: PreflightItemId;
  readonly status: ItemStatus;
  readonly finding: Finding;
  readonly blocking: boolean;
  readonly permission: string;
  readonly role?: string;
  readonly member?: string;
  readonly resource: string;
  readonly commands: readonly string[];
  readonly upstream?: UpstreamSummary;
}

export interface QuotaCandidate {
  readonly project: string;
  readonly source: 'scope' | 'chosen';
  readonly result: CandidateResult;
  readonly commands: readonly string[];
  readonly upstream?: UpstreamSummary;
}

export interface PreflightAnswer {
  readonly scope: string;
  readonly kind: ScopeKind;
  readonly mode: AccessMode;
  readonly outcome: PreflightOutcome;
  readonly displayName?: string;
  readonly quotaProject?: string;
  readonly member?: string;
  readonly serviceAccount?: string;
  readonly items: readonly PreflightItem[];
  readonly candidates: readonly QuotaCandidate[];
}

export interface PreflightRequest {
  readonly scope: string;
  readonly mode: AccessMode;
  readonly quotaProject?: string;
}

export type PreflightCallOutcome =
  | { readonly kind: 'answer'; readonly answer: PreflightAnswer }
  /** No usable token, or the backend answered 401 (the session then expires: fetchWithToken). */
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'error'; readonly message: string };

const ITEM_IDS: readonly PreflightItemId[] = [
  'scope-details',
  'quota-project',
  'cai-access',
  'sa-caller',
  'sa-exposure',
  'sa-access',
];
const STATUSES: readonly ItemStatus[] = ['ok', 'missing', 'unknown'];
const FINDINGS: readonly Finding[] = [
  'ok',
  'denied',
  'exposed',
  'no-candidate',
  'unusable',
  'not-checked',
  'no-credentials',
  'sign-in',
  'transient',
  'unexpected',
];
const RESULTS: readonly CandidateResult[] = [
  'usable',
  'not-found',
  'no-permission',
  'api-disabled',
  'sign-in',
  'transient',
  'unexpected',
];
const OUTCOMES: readonly PreflightOutcome[] = ['ready', 'blocked', 'sign-in', 'retry'];

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export function isUpstreamSummary(value: unknown): value is UpstreamSummary {
  return (
    isRecord(value) &&
    typeof value.status === 'number' &&
    Number.isInteger(value.status) &&
    optionalString(value.code) &&
    optionalString(value.reason) &&
    optionalString(value.message)
  );
}

function isItem(value: unknown): value is PreflightItem {
  return (
    isRecord(value) &&
    oneOf(ITEM_IDS, value.id) &&
    oneOf(STATUSES, value.status) &&
    oneOf(FINDINGS, value.finding) &&
    typeof value.blocking === 'boolean' &&
    typeof value.permission === 'string' &&
    optionalString(value.role) &&
    optionalString(value.member) &&
    typeof value.resource === 'string' &&
    isStringArray(value.commands) &&
    (value.upstream === undefined || isUpstreamSummary(value.upstream))
  );
}

function isCandidate(value: unknown): value is QuotaCandidate {
  return (
    isRecord(value) &&
    typeof value.project === 'string' &&
    (value.source === 'scope' || value.source === 'chosen') &&
    oneOf(RESULTS, value.result) &&
    isStringArray(value.commands) &&
    (value.upstream === undefined || isUpstreamSummary(value.upstream))
  );
}

/** Whether a body is a preflight answer, field by field. */
export function isPreflightAnswer(value: unknown): value is PreflightAnswer {
  return (
    isRecord(value) &&
    typeof value.scope === 'string' &&
    oneOf(SCOPE_KINDS, value.kind) &&
    (value.mode === 'user' || value.mode === 'sa') &&
    oneOf(OUTCOMES, value.outcome) &&
    optionalString(value.displayName) &&
    optionalString(value.quotaProject) &&
    optionalString(value.member) &&
    optionalString(value.serviceAccount) &&
    Array.isArray(value.items) &&
    value.items.every(isItem) &&
    Array.isArray(value.candidates) &&
    value.candidates.every(isCandidate)
  );
}

/** A sentence for an error answer of this backend (`{ statusCode, error, message, requestId, code }`). */
export function readError(status: number, body: unknown): string {
  if (status === 429) return 'Too many requests for this sign-in. Wait a minute, then try again.';
  const message = isRecord(body) && typeof body.message === 'string' ? body.message : null;
  if (status >= 500 || message === null)
    return `The backend could not answer (HTTP ${String(status)}). Try again.`;
  return message;
}

export async function requestPreflight(
  auth: AuthControls,
  request: PreflightRequest,
  signal?: AbortSignal,
): Promise<PreflightCallOutcome> {
  let response: Response;
  try {
    response = await fetchWithToken(auth, '/api/preflight', {
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
  // Service-account mode: when the gate refuses (403, or 503 to try again), the backend still sends the checklist
  // as `preflight`, so the page can say which grant is missing (backend/src/routes/preflight.ts).
  if (!response.ok && isRecord(body) && isPreflightAnswer(body.preflight))
    return { kind: 'answer', answer: body.preflight };
  if (!response.ok) return { kind: 'error', message: readError(response.status, body) };
  return isPreflightAnswer(body)
    ? { kind: 'answer', answer: body }
    : { kind: 'error', message: 'The backend answered the check in a way this page does not understand.' };
}
