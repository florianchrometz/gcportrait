// SPDX-License-Identifier: MIT
/**
 * `POST /api/assets/stream` (skill cai-ingestion §1 and §4): a live pull of one scope from Cloud Asset
 * Inventory, streamed to the browser as NDJSON frames (../stream/asset-list.ts) that `@gcportrait/ingest`
 * reads in the app's import worker.
 *
 * Body (schema-validated, nothing else accepted): `{ scope, readTime?, contentType: "RESOURCE", assetTypes?, mode,
 * quotaProject? }`; the pull's fields, mode rule and credentials are ../stream/pull.ts's, shared with the render
 * route.
 * - `mode: "user"`: the caller's bearer token is forwarded, and `quotaProject` is required: it goes into
 *   `x-goog-user-project`, so the user's own project pays (never the instance's project; AGENTS.md, Security
 *   and privacy, Quota project and the permission check).
 * - `mode: "sa"`: only when the operator enabled service-account mode, and only through the service-account
 *   gate (../auth/gate.ts), which runs before every CAI call (a pass is remembered for at most five minutes
 *   per caller-token hash and scope); the account's own token, no quota header (its own project pays).
 *   Without the instance's identity this build refuses service-account mode: the gate is never skipped.
 *
 * Answers: 400 (body), 401 (no bearer token, or Google did not accept it at the gate), 403 (service-account mode
 * off, or refused by the gate: ../auth/refusal.ts), 429 (the rate limit per token hash, or more than four streams
 * at once for one token), 501 (service-account mode not in this build), 503 (the gate could not finish: try
 * again); otherwise 200 with frames, Google's own errors arriving as `error` frames, and a gate that closes in the
 * middle of a stream as an `error` frame too. Each page's bytes count against the process-wide page budget
 * (../stream/page-budget.ts) until its frame has been written out; a page it cannot hold after the retries ends
 * the stream with `INSTANCE_BUSY`. A client that does not take a piece of up to 1 MiB within 60 s (one that
 * stopped, or reads slower than about 17 KiB/s) has its connection closed (../stream/ndjson.ts).
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
export type AssetsStreamRequest = z.infer<typeof AssetsStreamRequestSchema>;

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
