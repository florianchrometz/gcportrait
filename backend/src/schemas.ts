// SPDX-License-Identifier: MIT
import { UpstreamSummarySchema } from '@gcportrait/model';
import * as z from 'zod';

/**
 * Response contracts. Each is written once as a zod schema (the type comes from z.infer) and handed to
 * Fastify as JSON Schema produced by zod's own converter, so Fastify's built-in serializer
 * (fast-json-stringify) emits only the declared fields and fails loudly when a required one is missing.
 * See backend/README.md for why it is used rather than a type-provider package.
 */

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

/** GET /api/config and GET /api/legal, declared once in @gcportrait/model, which the app reads too. */
export {
  LegalTextsSchema as LegalResponseSchema,
  PublicConfigSchema as PublicConfigResponseSchema,
  type LegalTexts as LegalResponse,
  type PublicConfig as PublicConfigResponse,
} from '@gcportrait/model';

/** What Google answered, when its answer led to this one: declared once in @gcportrait/model. */
export { UpstreamSummarySchema };

/**
 * Every error answer of the server, whatever the route (docs/api.md, Errors), built in one place (./errors.ts):
 * `code` is for scripts, `retryable: true` comes with `Retry-After`, `reason` is Google's `ErrorInfo` reason and
 * `upstream` Google's own answer, when one led to this one.
 */
export const ErrorResponseSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  requestId: z.string(),
  code: z.string(),
  retryable: z.literal(true).optional(),
  reason: z.string().optional(),
  upstream: UpstreamSummarySchema.optional(),
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
