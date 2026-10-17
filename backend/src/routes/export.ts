// SPDX-License-Identifier: MIT
/**
 * `POST /api/export/read` (skill cai-ingestion §1): reads a Cloud Asset Inventory export from Cloud
 * Storage with the caller's own token (`storage.objects.get` on the bucket, docs/permissions.md) and streams its
 * NDJSON lines (../stream/export-read.ts), which `@gcportrait/ingest` reads in the app's import worker. One object,
 * or every object under a prefix.
 *
 * Body (schema-validated): `{ gcsUri: "gs://BUCKET/OBJECT" }`. Answers: 400 (body), 401 (no bearer token), 429
 * (the rate limit per token hash, or four streams already running for the token); otherwise 200 with the
 * export's lines and two headers for the progress bar, `x-gcportrait-export-objects` and
 * `x-gcportrait-export-bytes`. Cloud Storage's own errors arrive as `error` frames.
 */
import type { FastifyInstance } from 'fastify';
import * as z from 'zod';

import { tokenKeyOf } from '../stream/caller.js';
import {
  exportLines,
  parseGcsUri,
  planExportRead,
  type ExportReadOptions,
  type ExportReadStats,
} from '../stream/export-read.js';
import { frameLine } from '../stream/frames.js';
import { sendNdjson, watchResponse } from '../stream/ndjson.js';
import { STREAMS_BUSY_RETRY_SECONDS, type StreamSlots } from '../stream/slots.js';
import type { UpstreamClient } from '../upstream/request.js';
import { authenticate, firstIssue, sendError } from '../upstream/route-support.js';
import { TokenRateLimiter } from '../upstream/token-limit.js';

export const ExportReadRequestSchema = z.strictObject({
  gcsUri: z
    .string()
    .max(1100)
    .refine((uri) => parseGcsUri(uri) !== null, 'must be gs://BUCKET/OBJECT or gs://BUCKET/PREFIX/'),
});
export type ExportReadRequest = z.infer<typeof ExportReadRequestSchema>;

/** The response headers that announce what the read covers, so the app can show a share of the bytes read. */
export const EXPORT_OBJECTS_HEADER = 'x-gcportrait-export-objects';
export const EXPORT_BYTES_HEADER = 'x-gcportrait-export-bytes';

export interface ExportReadRouteOptions {
  readonly upstream: UpstreamClient;
  readonly slots: StreamSlots;
  readonly ratePerMinute: number;
  /** How long the response waits for its client to take a piece (../stream/ndjson.ts); tests lower it. */
  readonly stallMs?: number;
}

export function registerExportReadRoute(app: FastifyInstance, options: ExportReadRouteOptions): void {
  // The rate limit per token hash, next to the server's per-address one (upstream/token-limit.ts).
  const limiter = new TokenRateLimiter({ max: options.ratePerMinute });
  app.post('/api/export/read', async (request, reply) => {
    const token = authenticate(request, reply, limiter);
    if (token === null) return reply;
    const parsed = ExportReadRequestSchema.safeParse(request.body);
    if (!parsed.success)
      return sendError(request, reply, 400, `Invalid request: ${firstIssue(parsed.error)}.`);
    const location = parseGcsUri(parsed.data.gcsUri);
    if (location === null)
      return sendError(request, reply, 400, 'Invalid request: gcsUri: must be gs://BUCKET/OBJECT.');

    const release = options.slots.acquire(tokenKeyOf(token));
    if (release === null) {
      reply.header('retry-after', String(STREAMS_BUSY_RETRY_SECONDS));
      return sendError(
        request,
        reply,
        429,
        'Four streams are already running for this sign-in. Wait for one to finish, then try again.',
      );
    }
    const started = Date.now();
    const stats: ExportReadStats = { objects: 0, bytes: 0, retries: 0 };
    const life = watchResponse(reply, (outcome) => {
      release();
      request.log.info(
        { stream: 'export', ...stats, outcome, ms: Date.now() - started },
        'export read ended',
      );
    });
    const readOptions: ExportReadOptions = {
      client: options.upstream,
      token,
      stats,
      onRetry: (event) => {
        stats.retries += 1;
        request.log.warn({ upstream: 'storage', ...event }, 'retrying upstream');
      },
    };

    let plan;
    try {
      plan = await planExportRead(location, readOptions, life.signal);
    } catch (error) {
      // The client left while the export was being looked up: there is no one to answer.
      if (life.signal.aborted) return reply.code(499).send();
      throw error;
    }
    if (!plan.ok) {
      stats.end = plan.frame.code ?? 'error';
      return sendNdjson(reply, life, () => [frameLine(plan.frame)], {
        log: request.log,
        ...(options.stallMs === undefined ? {} : { stallMs: options.stallMs }),
      });
    }
    return sendNdjson(reply, life, (signal) => exportLines(location, plan.objects, readOptions, signal), {
      log: request.log,
      ...(options.stallMs === undefined ? {} : { stallMs: options.stallMs }),
      headers: {
        [EXPORT_OBJECTS_HEADER]: String(plan.objects.length),
        [EXPORT_BYTES_HEADER]: String(plan.bytes),
      },
    });
  });
}
