// SPDX-License-Identifier: MIT
import { z } from 'zod';

/**
 * Response contracts. Each is written once as a zod schema (the type comes from z.infer) and handed to
 * Fastify as JSON Schema produced by zod's own converter, so Fastify's built-in serializer
 * (fast-json-stringify) emits only the declared fields and fails loudly when a required one is missing.
 * See backend/README.md for why this was chosen over a type-provider package.
 */

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const PublicConfigResponseSchema = z.object({
  oauthClientId: z.string().nullable(),
  saMode: z.boolean(),
  /** Whether the service-account gate runs the strict exposure check (SA_MODE_STRICT_EXPOSURE). */
  saStrictExposure: z.boolean(),
  backendServiceAccount: z.string().nullable(),
  version: z.string(),
  /** Where the source of the running version is published (the footer's "Source (MIT)" link; SOURCE_URL). */
  sourceUrl: z.string(),
  /** Who runs this instance, "Hosted by NAME.", or null when HOSTED_BY names nobody (routes/config.ts). */
  hostedBy: z.string().nullable(),
  demo: z.literal(false),
  /**
   * Demo-only mode (DEMO_ONLY; ADR 0032): no sign-in, no service-account mode, no route that calls Google; the
   * Connect page offers the demo organisations only.
   */
  demoOnly: z.boolean(),
  /**
   * The instance's legal pages. `impressum` and `privacy`: whether it serves that page's text (LEGAL_DIR or
   * LEGAL_BUNDLE; the text comes from /api/legal). `impressumUrl` and `privacyUrl`: the page's address where the
   * operator publishes it elsewhere (LEGAL_IMPRESSUM_URL, LEGAL_PRIVACY_URL), or null. A page is one or the other.
   */
  legal: z.object({
    impressum: z.boolean(),
    privacy: z.boolean(),
    impressumUrl: z.string().nullable(),
    privacyUrl: z.string().nullable(),
  }),
  /** The render API's limits (`POST /api/render`, ADR 0033), or null where the route is off (RENDER_API, DEMO_ONLY). */
  render: z
    .object({
      maxAssets: z.number().int(),
      maxPixels: z.number().int(),
      maxBodyBytes: z.number().int(),
      timeoutMs: z.number().int(),
    })
    .nullable(),
});
export type PublicConfigResponse = z.infer<typeof PublicConfigResponseSchema>;

/** GET /api/legal: the Markdown of each legal page, or null for a page the instance does not publish. */
export const LegalResponseSchema = z.object({
  impressum: z.string().nullable(),
  privacy: z.string().nullable(),
});
export type LegalResponse = z.infer<typeof LegalResponseSchema>;

export const ErrorResponseSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  requestId: z.string(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/** Draft-07 JSON Schema for a zod schema, without the `$schema` marker (Fastify compiles it as-is). */
export function toFastifySchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema: Record<string, unknown> = {
    ...z.toJSONSchema(schema, { target: 'draft-07', io: 'output' }),
  };
  delete jsonSchema.$schema;
  return jsonSchema;
}
