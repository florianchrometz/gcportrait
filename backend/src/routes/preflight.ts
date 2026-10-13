// SPDX-License-Identifier: MIT
/**
 * `POST /api/preflight` (docs/permissions.md; agents.md, Security and privacy, Quota project and the
 * permission check): checks, with the caller's own token, what a pull of one scope needs, and answers the
 * checklist with copy-ready `gcloud` commands (../preflight/run.ts; the contract in ../preflight/schemas.ts).
 *
 * Body (schema-validated, nothing else accepted): `{ scope, mode: "user" | "sa", quotaProject? }`.
 *
 * Answers: 200 with the checklist (also when something is missing: the items say what); 400 (body); 401 (no
 * bearer token, or Google did not accept it); 403 (service-account mode is off on this instance, or its gate
 * refused: ../auth/gate.ts); 429 (the rate limit per token hash); 501 (service-account mode not in this build); 503
 * (the gate could not finish: try again). A refusal of the gate carries the checklist as `preflight` next to the
 * error fields (`code`, `message`, …), so the Permissions page can still say which grant is missing, while no
 * client can mistake it for a passed check.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ServiceAccountGate } from '../auth/gate.js';
import { sendRefusal } from '../auth/refusal.js';
import type { ServerConfig } from '../config.js';
import { runPreflight } from '../preflight/run.js';
import {
  PreflightRequestSchema,
  PreflightResponseSchema,
  UpstreamSummarySchema,
  type PreflightResponse,
} from '../preflight/schemas.js';
import { ErrorResponseSchema, toFastifySchema } from '../schemas.js';
import type { UpstreamClient } from '../upstream/request.js';
import {
  authenticate,
  firstIssue,
  googleContextFor,
  sendError,
  sendUnauthenticated,
  SIGN_IN_AGAIN_MESSAGE,
} from '../upstream/route-support.js';
import { TokenRateLimiter } from '../upstream/token-limit.js';

/** Preflights per token hash and minute: a person checks a scope now and then, never in a loop. */
export const PREFLIGHT_PER_MINUTE = 30;

/**
 * The body of a 403 or 503: the server's error shape, plus, for a refusal of the service-account gate, its code,
 * Google's answer and the checklist (`preflight`).
 */
export const PreflightRefusalSchema = ErrorResponseSchema.extend({
  code: z.string().optional(),
  retryable: z.literal(true).optional(),
  upstream: UpstreamSummarySchema.optional(),
  preflight: PreflightResponseSchema.optional(),
});

export interface PreflightRouteOptions {
  readonly config: Pick<ServerConfig, 'saModeEnabled' | 'backendServiceAccount'>;
  readonly upstream: UpstreamClient;
  /** Service-account mode's gate, or null when this instance has no identity for it. */
  readonly gate: ServiceAccountGate | null;
  readonly perMinute?: number;
}

export function registerPreflightRoute(app: FastifyInstance, options: PreflightRouteOptions): void {
  const limiter = new TokenRateLimiter({ max: options.perMinute ?? PREFLIGHT_PER_MINUTE });

  app.post<{ Reply: PreflightResponse }>(
    '/api/preflight',
    {
      schema: {
        response: {
          200: toFastifySchema(PreflightResponseSchema),
          403: toFastifySchema(PreflightRefusalSchema),
          503: toFastifySchema(PreflightRefusalSchema),
        },
      },
    },
    async (request, reply) => {
      const token = authenticate(request, reply, limiter);
      if (token === null) return reply;
      const parsed = PreflightRequestSchema.safeParse(request.body);
      if (!parsed.success)
        return sendError(request, reply, 400, `Invalid request: ${firstIssue(parsed.error)}.`);
      const body = parsed.data;
      if (body.mode === 'sa' && !options.config.saModeEnabled) {
        return sendError(request, reply, 403, 'Service-account mode is off on this gcportrait instance.');
      }
      if (body.mode === 'sa' && options.gate === null) {
        return sendError(
          request,
          reply,
          501,
          'Service-account mode is not available in this build of gcportrait.',
        );
      }

      const result = await runPreflight(
        {
          scope: body.scope,
          mode: body.mode,
          token,
          ...(body.quotaProject === undefined ? {} : { quotaProject: body.quotaProject }),
        },
        {
          context: googleContextFor(request, reply, options.upstream),
          gate: options.gate,
          serviceAccountEmail: options.gate?.email ?? options.config.backendServiceAccount,
        },
      );
      if (result.kind === 'unauthenticated')
        return sendUnauthenticated(request, reply, SIGN_IN_AGAIN_MESSAGE);
      // The gate did not pass: never a 200, whatever the checklist says.
      if (result.refusal !== undefined)
        return sendRefusal(request, reply, result.refusal, { preflight: result.response });
      return reply.code(200).send(result.response);
    },
  );
}
