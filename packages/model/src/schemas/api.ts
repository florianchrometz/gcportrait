// SPDX-License-Identifier: MIT
import * as z from 'zod';

import {
  PREFLIGHT_FINDINGS,
  PREFLIGHT_ITEM_IDS,
  PREFLIGHT_ITEM_STATUSES,
  PREFLIGHT_MODES,
  PREFLIGHT_OUTCOMES,
  QUOTA_CANDIDATE_RESULTS,
  QUOTA_CANDIDATE_SOURCES,
} from './api-vocabulary.js';
import { ScopeKindSchema } from './snapshot.js';

/**
 * The backend's public answers the app reads (docs/api.md): GET /api/config, GET /api/legal, POST /api/preflight
 * and POST /api/scopes/search. The backend hands
 * these schemas to Fastify as its response contracts; the app's UI thread, which never loads zod, takes the
 * inferred types with `import type` and checks an answer with its own guards, which a test holds to these schemas.
 */

/**
 * The instance's legal pages. `impressum` and `privacy`: whether it serves that page's text (LEGAL_DIR or
 * LEGAL_BUNDLE; the text comes from GET /api/legal). `impressumUrl` and `privacyUrl`: the page's address where the
 * operator publishes it elsewhere (LEGAL_IMPRESSUM_URL, LEGAL_PRIVACY_URL), or null. A page is one or the other.
 */
export const LegalPagesSchema = z.object({
  impressum: z.boolean(),
  privacy: z.boolean(),
  impressumUrl: z.string().nullable(),
  privacyUrl: z.string().nullable(),
});
export type LegalPages = z.infer<typeof LegalPagesSchema>;

/** The render API's limits (`POST /api/render`). */
export const RenderLimitsSchema = z.object({
  maxAssets: z.number().int(),
  maxPixels: z.number().int(),
  maxBodyBytes: z.number().int(),
  timeoutMs: z.number().int(),
});
export type RenderLimits = z.infer<typeof RenderLimitsSchema>;

/** GET /api/config: what the instance offers, every field always sent. */
export const PublicConfigSchema = z.object({
  oauthClientId: z.string().nullable(),
  saMode: z.boolean(),
  /** Whether the service-account gate runs the strict exposure check (SA_MODE_STRICT_EXPOSURE). */
  saStrictExposure: z.boolean(),
  backendServiceAccount: z.string().nullable(),
  version: z.string(),
  /** Where the source of the running version is published (the footer's "Source (MIT)" link; SOURCE_URL). */
  sourceUrl: z.string(),
  /** Who runs this instance, "Hosted by NAME.", or null when HOSTED_BY names nobody. */
  hostedBy: z.string().nullable(),
  /** Always false: an instance is never the build-time demo, which asks no backend. */
  demo: z.literal(false),
  /**
   * Demo-only mode (DEMO_ONLY; AGENTS.md, Modes and hosting): no sign-in, no service-account mode, no route that
   * calls Google; the Connect page offers the demo organisations only.
   */
  demoOnly: z.boolean(),
  legal: LegalPagesSchema,
  /** The render API's limits, or null where the route is off (RENDER_API, DEMO_ONLY). */
  render: RenderLimitsSchema.nullable(),
});
export type PublicConfig = z.infer<typeof PublicConfigSchema>;

/** GET /api/legal: the Markdown of each legal page, or null for a page the instance does not serve. */
export const LegalTextsSchema = z.object({
  impressum: z.string().nullable(),
  privacy: z.string().nullable(),
});
export type LegalTexts = z.infer<typeof LegalTextsSchema>;

/** What Google answered, when its answer led to this one: a preflight item, a search problem, an error answer. */
export const UpstreamSummarySchema = z.object({
  /** Google's HTTP status; 0 when no answer arrived (timeout, transport failure). */
  status: z.number().int(),
  code: z.string().optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
});
export type UpstreamSummary = z.infer<typeof UpstreamSummarySchema>;

/**
 * One row of the preflight's checklist. It carries facts and commands, not sentences: `finding` is a code the
 * Permissions page words, and `commands` are copy-ready `gcloud` lines with every value filled in that the backend
 * knows (the scope, the quota project, the caller's or the account's email).
 */
export const PreflightItemSchema = z.object({
  id: z.enum(PREFLIGHT_ITEM_IDS),
  status: z.enum(PREFLIGHT_ITEM_STATUSES),
  finding: z.enum(PREFLIGHT_FINDINGS),
  /** Whether a pull needs it; `scope-details` in user mode does not (a denied `get` of the scope is a warning). */
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

/** A quota project tried in user mode, and what Google said of it. */
export const QuotaCandidateSchema = z.object({
  project: z.string(),
  source: z.enum(QUOTA_CANDIDATE_SOURCES),
  result: z.enum(QUOTA_CANDIDATE_RESULTS),
  commands: z.array(z.string()),
  upstream: UpstreamSummarySchema.optional(),
});
export type QuotaCandidate = z.infer<typeof QuotaCandidateSchema>;

/** POST /api/preflight (docs/permissions.md): the checklist for a scope, in user or service-account mode. */
export const PreflightResponseSchema = z.object({
  /** The scope checked, canonical (`organizations/123`, `folders/456`, `projects/my-project`). */
  scope: z.string(),
  kind: ScopeKindSchema,
  mode: z.enum(PREFLIGHT_MODES),
  outcome: z.enum(PREFLIGHT_OUTCOMES),
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

/** One organisation, folder or project the scope search found. */
export const ScopeSearchResultSchema = z.object({
  kind: ScopeKindSchema,
  /** The scope as the preflight and the stream take it: `organizations/123`, `folders/456`, `projects/my-id`. */
  scope: z.string(),
  /** The organisation or folder number, or the project id. */
  id: z.string(),
  displayName: z.string(),
  /** `organizations/…` or `folders/…`, when Google names a parent. */
  parent: z.string().optional(),
  /** A project's number. */
  projectNumber: z.string().optional(),
});
export type ScopeSearchResult = z.infer<typeof ScopeSearchResultSchema>;

/** A kind whose search failed, with what Google answered. */
export const ScopeSearchProblemSchema = z.object({ kind: ScopeKindSchema, upstream: UpstreamSummarySchema });
export type ScopeSearchProblem = z.infer<typeof ScopeSearchProblemSchema>;

/** POST /api/scopes/search: the scopes the caller can see that match the text, a page at a time. */
export const ScopeSearchResponseSchema = z.object({
  scopes: z.array(ScopeSearchResultSchema),
  /** Opaque; sent back for the next page of the same query and kinds. Absent on the last page. */
  nextPageToken: z.string().optional(),
  /** Kinds whose search failed; the other kinds' results are still listed. */
  problems: z.array(ScopeSearchProblemSchema),
});
export type ScopeSearchResponse = z.infer<typeof ScopeSearchResponseSchema>;
