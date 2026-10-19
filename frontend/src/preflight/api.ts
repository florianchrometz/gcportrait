// SPDX-License-Identifier: Apache-2.0
/**
 * Client for `POST /api/preflight` (docs/api.md, docs/permissions.md). The answer's contract is declared once, in
 * @gcportrait/model (`PreflightResponseSchema`, the backend's response contract): the types come from it erased
 * and the closed lists (findings, item ids, outcomes, …) from its zod-free vocabulary, so no zod reaches the UI
 * thread, and `isPreflightAnswer` checks every field by hand, held to the schema by api.test.ts. An answer that
 * does not fit is an error, never half shown. The token goes only to this backend, through `fetchWithToken`
 * (src/auth).
 */
import {
  PREFLIGHT_FINDINGS,
  PREFLIGHT_ITEM_IDS,
  PREFLIGHT_ITEM_STATUSES,
  PREFLIGHT_MODES,
  PREFLIGHT_OUTCOMES,
  QUOTA_CANDIDATE_RESULTS,
  QUOTA_CANDIDATE_SOURCES,
  type PreflightItem,
  type PreflightMode,
  type PreflightResponse,
  type QuotaCandidate,
  type UpstreamSummary,
} from '@gcportrait/model';

import { postJson, readError } from '../api/json';
import type { AuthControls } from '../auth';
import { isRecord } from '../guards';
import { SCOPE_KINDS } from '../scope/scopeName';

export type {
  PreflightFinding as Finding,
  PreflightItem,
  PreflightItemId,
  PreflightItemStatus as ItemStatus,
  PreflightOutcome,
  QuotaCandidate,
  QuotaCandidateResult as CandidateResult,
  UpstreamSummary,
} from '@gcportrait/model';
export type AccessMode = PreflightMode;
export type PreflightAnswer = PreflightResponse;

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
    Number.isInteger(value.status) &&
    optionalString(value.code) &&
    optionalString(value.reason) &&
    optionalString(value.message)
  );
}

function isItem(value: unknown): value is PreflightItem {
  return (
    isRecord(value) &&
    oneOf(PREFLIGHT_ITEM_IDS, value.id) &&
    oneOf(PREFLIGHT_ITEM_STATUSES, value.status) &&
    oneOf(PREFLIGHT_FINDINGS, value.finding) &&
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
    oneOf(QUOTA_CANDIDATE_SOURCES, value.source) &&
    oneOf(QUOTA_CANDIDATE_RESULTS, value.result) &&
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
    oneOf(PREFLIGHT_MODES, value.mode) &&
    oneOf(PREFLIGHT_OUTCOMES, value.outcome) &&
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

export { readError };

export async function requestPreflight(
  auth: AuthControls,
  request: PreflightRequest,
  signal?: AbortSignal,
): Promise<PreflightCallOutcome> {
  const result = await postJson(auth, '/api/preflight', request, signal);
  if (result.kind !== 'response') return result;
  const { response, body } = result;
  // Service-account mode: when the gate refuses (403, or 503 to try again), the backend still sends the checklist
  // as `preflight`, so the page can say which grant is missing (backend/src/routes/preflight.ts).
  if (!response.ok && isRecord(body) && isPreflightAnswer(body.preflight))
    return { kind: 'answer', answer: body.preflight };
  if (!response.ok) return { kind: 'error', message: readError(response.status, body) };
  return isPreflightAnswer(body)
    ? { kind: 'answer', answer: body }
    : { kind: 'error', message: 'The backend answered the check in a way this page does not understand.' };
}
