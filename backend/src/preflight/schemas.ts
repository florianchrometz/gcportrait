// SPDX-License-Identifier: MIT
/**
 * The contract of `POST /api/preflight` (docs/permissions.md), written once as zod schemas: the route
 * validates the body with the request schema and Fastify serialises the answer through the response schema
 * (../schemas.ts, `toFastifySchema`), so nothing undeclared leaves the backend. The SPA reads the same shape
 * with its own zod-free guards (frontend/src/preflight/api.ts; no zod on the UI thread).
 *
 * The answer carries facts and commands, not sentences: each item's `finding` is a code the Permissions page
 * words, and `commands` are copy-ready `gcloud` lines with every value filled in that the backend knows (the
 * scope, the quota project, the caller's or the account's email).
 */
import { ScopeKindSchema } from '@gcportrait/model';
import * as z from 'zod';

import { QuotaProjectSchema, ScopeNameSchema } from '../upstream/scope.js';

export const PREFLIGHT_MODES = ['user', 'sa'] as const;
export type PreflightMode = (typeof PREFLIGHT_MODES)[number];

export const PreflightRequestSchema = z
  .strictObject({
    scope: ScopeNameSchema,
    mode: z.enum(PREFLIGHT_MODES),
    /** User mode: the project the person picked to pay for CAI calls; tried after the scope itself (§2). */
    quotaProject: QuotaProjectSchema.optional(),
  })
  .superRefine((body, context) => {
    // Service-account mode never sends a quota project: the account's own project pays.
    if (body.mode === 'sa' && body.quotaProject !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['quotaProject'],
        message: "must be left out in service-account mode, which uses this instance's own project",
      });
  });
export type PreflightRequest = z.infer<typeof PreflightRequestSchema>;

/** `ok`: verified; `missing`: verified absent (a command fixes it); `unknown`: could not be verified. */
export const ITEM_STATUSES = ['ok', 'missing', 'unknown'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/**
 * The checklist rows (docs/permissions.md):
 * - user mode: `scope-details` (`resourcemanager.*.get`, a warning only), `quota-project` (the API enabled and
 *   `serviceusage.services.use` on it), `cai-access` (`roles/cloudasset.viewer` on the scope);
 * - service-account mode: `sa-caller` (gate step 1: the caller's own `get`), `sa-exposure` (gate step 2: the
 *   account must not be able to `get` the scope), `sa-access` (the account's own `roles/cloudasset.viewer`).
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
export const FINDINGS = [
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
export type Finding = (typeof FINDINGS)[number];

export const UpstreamSummarySchema = z.object({
  /** Google's HTTP status; 0 when no answer arrived (timeout, transport failure). */
  status: z.number().int(),
  code: z.string().optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
});

export const PreflightItemSchema = z.object({
  id: z.enum(PREFLIGHT_ITEM_IDS),
  status: z.enum(ITEM_STATUSES),
  finding: z.enum(FINDINGS),
  /**
   * Whether a pull needs it; `scope-details` in user mode does not (a denied `get` of the scope is a
   * warning).
   */
  blocking: z.boolean(),
  /** The permission checked (`cloudasset.assets.listResource`, `resourcemanager.folders.get`, …). */
  permission: z.string(),
  /** The role that grants it (`roles/cloudasset.viewer`, …). */
  role: z.string().optional(),
  /** Who needs it: `user:…`, `serviceAccount:…`. */
  member: z.string().optional(),
  /** Where it is needed: the scope, or `projects/QP` for the quota project. */
  resource: z.string(),
  /** Copy-ready `gcloud` commands that would fix a `missing` (or, unverified, a `not-checked`) item. */
  commands: z.array(z.string()),
  upstream: UpstreamSummarySchema.optional(),
});
export type PreflightItem = z.infer<typeof PreflightItemSchema>;

/**
 * A quota project tried in user mode:
 * - `usable`: Google accepted it as the quota project (the listing itself may still be refused);
 * - `not-found`: it does not exist or was deleted (400 `USER_PROJECT_DENIED`);
 * - `no-permission`: no `serviceusage.services.use` on it (403 `USER_PROJECT_DENIED`);
 * - `api-disabled`: the Cloud Asset API is disabled in it (403 `SERVICE_DISABLED`);
 * - `sign-in`, `transient`, `unexpected`: as for the items; trying stops there.
 */
export const CANDIDATE_RESULTS = [
  'usable',
  'not-found',
  'no-permission',
  'api-disabled',
  'sign-in',
  'transient',
  'unexpected',
] as const;
export type CandidateResult = (typeof CANDIDATE_RESULTS)[number];

export const QuotaCandidateSchema = z.object({
  project: z.string(),
  /** `scope`: the scanned project itself; `chosen`: the project the person picked. */
  source: z.enum(['scope', 'chosen']),
  result: z.enum(CANDIDATE_RESULTS),
  commands: z.array(z.string()),
  upstream: UpstreamSummarySchema.optional(),
});
export type QuotaCandidate = z.infer<typeof QuotaCandidateSchema>;

/**
 * `ready`: every blocking item is ok, a pull will work; `sign-in`: the token must be renewed with the OAuth scope
 * the APIs need; `retry`: Google did not answer well enough, try again; `blocked`: a blocking item is missing or
 * not understood (the items say which, with commands).
 */
export const OUTCOMES = ['ready', 'blocked', 'sign-in', 'retry'] as const;
export type PreflightOutcome = (typeof OUTCOMES)[number];

export const PreflightResponseSchema = z.object({
  /** The scope checked, canonical (`organizations/123`, `folders/456`, `projects/my-project`). */
  scope: z.string(),
  kind: ScopeKindSchema,
  mode: z.enum(PREFLIGHT_MODES),
  outcome: z.enum(OUTCOMES),
  /** The scope's display name, when the caller may read it. */
  displayName: z.string().optional(),
  /** User mode: the quota project the pull will use (the first usable candidate). */
  quotaProject: z.string().optional(),
  /** The caller as an IAM member (`user:…`), when Google says who the token belongs to. */
  member: z.string().optional(),
  /** Service-account mode: the instance's account email. */
  serviceAccount: z.string().optional(),
  items: z.array(PreflightItemSchema),
  candidates: z.array(QuotaCandidateSchema),
});
export type PreflightResponse = z.infer<typeof PreflightResponseSchema>;
