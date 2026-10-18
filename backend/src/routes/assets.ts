// SPDX-License-Identifier: Apache-2.0
/**
 * POST /api/assets/stream: authenticate, validate the pull, take a stream slot and send assetListFrames
 * through the NDJSON writer. ../stream/pull.ts owns fields, mode validation and credentials shared
 * with the render route; ../stream/asset-list.ts owns pagination and page claims, ../stream/ndjson.ts
 * response lifetime and stalls. API: docs/api.md; policy: backend/AGENTS.md, Quota project and the
 * permission check, and The service-account gate.
 */
import type { FastifyInstance } from 'fastify';
import * as z from 'zod';

import type { ServiceAccountGate } from '../auth/gate.js';
import type { ServerConfig } from '../config.js';
import { sendError } from '../errors.js';
import { assetListFrames, type AssetListStats } from '../stream/asset-list.js';
import { sendNdjson, watchResponse } from '../stream/ndjson.js';
import type { PageBudget } from '../stream/page-budget.js';
import {
  assetListQueryOf,
  checkPullMode,
  pullCredentials,
  PullFieldsSchema,
  refuseUnavailableMode,
} from '../stream/pull.js';
import type { StreamSlots } from '../stream/slots.js';
import type { UpstreamClient } from '../upstream/request.js';
import { authenticate, invalidRequest, takeStreamSlot } from '../upstream/route-support.js';
import { TokenRateLimiter } from '../upstream/token-limit.js';

/** The pull's fields (../stream/pull.ts, shared with the render route) and the content type, always RESOURCE. */
export const AssetsStreamRequestSchema = PullFieldsSchema.extend({
  contentType: z.literal('RESOURCE'),
}).superRefine((body, context) => {
  checkPullMode(body, context);
});

export interface AssetStreamRouteOptions {
  readonly config: Pick<ServerConfig, 'saModeEnabled'>;
  readonly upstream: UpstreamClient;
  readonly slots: StreamSlots;
  /** The process-wide budget of page bytes held in memory (../stream/page-budget.ts). */
  readonly budget: PageBudget;
  /** Service-account mode's gate (../auth/gate.ts), or null when this instance has no identity for it. */
  readonly serviceAccount: ServiceAccountGate | null;
  /** Stream requests per token hash and minute (both streaming routes count separately). */
  readonly ratePerMinute: number;
  /** How long the response waits for its client to take a piece (../stream/ndjson.ts); tests lower it. */
  readonly stallMs?: number;
}

export function registerAssetStreamRoute(app: FastifyInstance, options: AssetStreamRouteOptions): void {
  // The rate limit per token hash, next to the server's per-address one (upstream/token-limit.ts).
  const limiter = new TokenRateLimiter({ max: options.ratePerMinute });
  const authority = {
    saModeEnabled: options.config.saModeEnabled,
    serviceAccount: options.serviceAccount,
    upstream: options.upstream,
  };
  app.post('/api/assets/stream', async (request, reply) => {
    const callerToken = authenticate(request, reply, limiter);
    if (callerToken === null) return reply;
    const parsed = AssetsStreamRequestSchema.safeParse(request.body);
    if (!parsed.success) return sendError(request, reply, invalidRequest(parsed.error));
    const body = parsed.data;
    const refused = refuseUnavailableMode(request, reply, body.mode, authority);
    if (refused !== null) return refused;

    const release = takeStreamSlot(request, reply, options.slots, callerToken);
    if (release === null) return reply;
    const started = Date.now();
    const stats: AssetListStats = { pages: 0, assets: 0, retries: 0 };
    const life = watchResponse(reply, (outcome) => {
      release();
      request.log.info(
        { stream: 'assets', mode: body.mode, ...stats, outcome, ms: Date.now() - started },
        'asset stream ended',
      );
    });

    const pull = await pullCredentials(
      request,
      reply,
      body,
      callerToken,
      authority,
      'assets.stream',
      life.signal,
    );
    if (!pull.ok) return pull.reply;

    return sendNdjson(
      reply,
      life,
      (signal) =>
        assetListFrames(
          assetListQueryOf(body),
          {
            client: options.upstream,
            credentials: pull.credentials,
            stats,
            budget: options.budget,
            onRetry: (event) => {
              request.log.warn({ upstream: 'cloudasset', ...event }, 'retrying upstream');
            },
          },
          signal,
        ),
      { log: request.log, ...(options.stallMs === undefined ? {} : { stallMs: options.stallMs }) },
    );
  });
}
