// SPDX-License-Identifier: Apache-2.0
/**
 * `POST /api/preflight` (docs/permissions.md; backend/AGENTS.md, Quota project and the
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

import type { ServiceAccountGate } from '../auth/gate.js';
import { sendRefusal } from '../auth/refusal.js';
import type { ServerConfig } from '../config.js';
import { sendError } from '../errors.js';
import { runPreflight } from '../preflight/run.js';
import {
  PreflightRequestSchema,
  PreflightResponseSchema,
  type PreflightResponse,
} from '../preflight/schemas.js';
import { ErrorResponseSchema, toFastifySchema } from '../schemas.js';
import { refuseUnavailableMode } from '../stream/pull.js';
import type { UpstreamClient } from '../upstream/request.js';
import {
  authenticate,
  googleContextFor,
  invalidRequest,
  isClientGoneError,
  sendClientGone,
  SIGN_IN_AGAIN_MESSAGE,
} from '../upstream/route-support.js';
import { TokenRateLimiter } from '../upstream/token-limit.js';

/** Preflights per token hash and minute: a person checks a scope now and then, never in a loop. */
export const PREFLIGHT_PER_MINUTE = 30;

/**
 * The body of a 403 or 503: the server's error shape (../errors.ts), plus, for a refusal of the service-account
 * gate, the checklist (`preflight`).
 */
export const PreflightRefusalSchema = ErrorResponseSchema.extend({
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
  // Service-account mode is checked as a pull checks it (../stream/pull.ts), before anything is asked of Google.
  const authority = { saModeEnabled: options.config.saModeEnabled, serviceAccount: options.gate };

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
      if (!parsed.success) return sendError(request, reply, invalidRequest(parsed.error));
      const body = parsed.data;
      const refused = refuseUnavailableMode(request, reply, body.mode, authority);
      if (refused !== null) return refused;

      const context = googleContextFor(request, reply, options.upstream);
      let result;
      try {
        result = await runPreflight(
          {
            scope: body.scope,
            mode: body.mode,
            token,
            ...(body.quotaProject === undefined ? {} : { quotaProject: body.quotaProject }),
          },
          {
            context,
            gate: options.gate,
            serviceAccountEmail: options.gate?.email ?? options.config.backendServiceAccount,
          },
        );
      } catch (error) {
        if (isClientGoneError(error, context.signal)) {
          return sendClientGone(reply);
        }
        throw error;
      }
      if (result.kind === 'unauthenticated')
        return sendError(request, reply, { status: 401, message: SIGN_IN_AGAIN_MESSAGE });
      // The gate did not pass: never a 200, whatever the checklist says.
      if (result.refusal !== undefined)
        return sendRefusal(request, reply, result.refusal, { preflight: result.response });
      return reply.code(200).send(result.response);
    },
  );
}
