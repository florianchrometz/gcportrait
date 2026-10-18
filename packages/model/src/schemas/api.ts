// SPDX-License-Identifier: MIT
import * as z from 'zod';

/**
 * The backend's public answers the app reads (docs/api.md): GET /api/config and GET /api/legal. The backend hands
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
