// SPDX-License-Identifier: Apache-2.0
/**
 * The closed vocabularies of the backend's preflight answer (POST /api/preflight, docs/permissions.md) as plain
 * tuples, in a module that imports no zod: the schemas in api.ts are built from them (`z.enum(PREFLIGHT_FINDINGS)`),
 * so each list is declared once, and the app's UI thread, which ships no zod, imports these values to check an
 * answer and to word every item and finding.
 */

/** `user`: the person's own account; `sa`: the instance's service account. */
export const PREFLIGHT_MODES = ['user', 'sa'] as const;
export type PreflightMode = (typeof PREFLIGHT_MODES)[number];

/** `ok`: verified; `missing`: verified absent (a command fixes it); `unknown`: could not be verified. */
export const PREFLIGHT_ITEM_STATUSES = ['ok', 'missing', 'unknown'] as const;
export type PreflightItemStatus = (typeof PREFLIGHT_ITEM_STATUSES)[number];

/**
 * The checklist rows (docs/permissions.md):
 * - user mode: `scope-details` (`resourcemanager.*.get`, a warning only), `quota-project` (the API enabled and
 *   `serviceusage.services.use` on it), `cai-access` (`roles/cloudasset.viewer` on the scope);
 * - service-account mode: `sa-caller` (the gate's `caller` check: `testIamPermissions` must return the scope's
 *   `get` permission), `sa-exposure` (the optional `exposure` check: the account's `get` must be an exact IAM
 *   denial), `sa-access` (the account's own `roles/cloudasset.viewer`).
 */
export const PREFLIGHT_ITEM_IDS = [
  'scope-details',
  'quota-project',
  'cai-access',
  'sa-caller',
  'sa-exposure',
  'sa-access',
] as const;
export type PreflightItemId = (typeof PREFLIGHT_ITEM_IDS)[number];

/**
 * Why an item has its status:
 * - `ok`: verified;
 * - `denied`: Google refused it for lack of the permission named (missing);
 * - `exposed`: the account can `get` the scope itself, so service-account mode is refused for it (missing);
 * - `no-candidate`: no quota project to try (an organisation or folder, and none picked) (missing);
 * - `unusable`: no candidate quota project works; `candidates` says why for each (missing);
 * - `not-checked`: an earlier check stopped the preflight first (unknown);
 * - `no-credentials`: the instance has no service-account credentials to check with (unknown);
 * - `sign-in`: the token lacks the OAuth scope the API needs: sign in again (unknown);
 * - `transient`: 429, 5xx or no answer after the retries: try again (unknown);
 * - `unexpected`: an answer the backend does not understand; it fails closed and passes Google's status, reason
 *   and message on (unknown).
 */
export const PREFLIGHT_FINDINGS = [
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
] as const;
export type PreflightFinding = (typeof PREFLIGHT_FINDINGS)[number];

/** Where a quota project tried in user mode came from: `scope`, the scanned project itself; `chosen`, the pick. */
export const QUOTA_CANDIDATE_SOURCES = ['scope', 'chosen'] as const;
export type QuotaCandidateSource = (typeof QUOTA_CANDIDATE_SOURCES)[number];

/**
 * A quota project tried in user mode:
 * - `usable`: Google accepted it as the quota project (the listing itself may still be refused);
 * - `not-found`: it does not exist or was deleted (400 `USER_PROJECT_DENIED`);
 * - `no-permission`: no `serviceusage.services.use` on it (403 `USER_PROJECT_DENIED`);
 * - `api-disabled`: the Cloud Asset API is disabled in it (403 `SERVICE_DISABLED`);
 * - `sign-in`, `transient`, `unexpected`: as for the items; trying stops there.
 */
export const QUOTA_CANDIDATE_RESULTS = [
  'usable',
  'not-found',
  'no-permission',
  'api-disabled',
  'sign-in',
  'transient',
  'unexpected',
] as const;
export type QuotaCandidateResult = (typeof QUOTA_CANDIDATE_RESULTS)[number];

/**
 * `ready`: every blocking item is ok, a pull will work; `sign-in`: the token must be renewed with the OAuth scope
 * the APIs need; `retry`: Google did not answer well enough, try again; `blocked`: a blocking item is missing or
 * not understood (the items say which, with commands).
 */
export const PREFLIGHT_OUTCOMES = ['ready', 'blocked', 'sign-in', 'retry'] as const;
export type PreflightOutcome = (typeof PREFLIGHT_OUTCOMES)[number];
