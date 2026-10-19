// SPDX-License-Identifier: Apache-2.0
/**
 * The contract of `POST /api/preflight` (docs/permissions.md), written once as zod schemas: the route
 * validates the body with the request schema and Fastify serialises the answer through the response schema
 * (../schemas.ts, `toFastifySchema`), so nothing undeclared leaves the backend. The response schema lives in
 * @gcportrait/model; the SPA takes its types and checks it with its own zod-free guards
 * (frontend/src/preflight/api.ts; no zod on the UI thread).
 *
 * The answer carries facts and commands, not sentences: each item's `finding` is a code the Permissions page
 * words, and `commands` are copy-ready `gcloud` lines with every value filled in that the backend knows (the
 * scope, the quota project, the caller's or the account's email).
 */
import { PREFLIGHT_MODES } from '@gcportrait/model';
import * as z from 'zod';

import { QuotaProjectSchema, ScopeNameSchema } from '../upstream/scope.js';

export { PREFLIGHT_MODES, type PreflightMode } from '@gcportrait/model';

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

/**
 * The answer, its rows and their closed vocabularies, declared once in @gcportrait/model (`schemas/api.ts` and the
 * zod-free `schemas/api-vocabulary.ts`), which the app reads too; here under the backend's names.
 */
export {
  PREFLIGHT_FINDINGS as FINDINGS,
  PREFLIGHT_ITEM_IDS,
  PREFLIGHT_ITEM_STATUSES as ITEM_STATUSES,
  PREFLIGHT_OUTCOMES as OUTCOMES,
  PreflightItemSchema,
  PreflightResponseSchema,
  QUOTA_CANDIDATE_RESULTS as CANDIDATE_RESULTS,
  QuotaCandidateSchema,
  type PreflightFinding as Finding,
  type PreflightItem,
  type PreflightOutcome,
  type PreflightResponse,
  type QuotaCandidate,
  type QuotaCandidateResult as CandidateResult,
} from '@gcportrait/model';
