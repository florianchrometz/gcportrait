// SPDX-License-Identifier: MIT
/**
 * How a refusal of the service-account gate (./gate.ts) reaches the caller, the same on every route that takes
 * `mode: "sa"`: before anything is streamed, as an HTTP error in the server's shape `{ statusCode, error,
 * message, requestId }` plus the gate's `code`, `retryable` and Google's answer when one led to it (401 with the
 * RFC 6750 challenge, 403 refused, 503 try again, with `Retry-After`); in the middle of a stream, as an `error`
 * frame.
 */
import { STATUS_CODES } from 'node:http';

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ErrorFrame } from '../stream/frames.js';
import type { UpstreamSummary } from '../upstream/google.js';
import { sendUnauthenticated } from '../upstream/route-support.js';
import type { GateRefusal } from './gate.js';

export interface GateRefusalBody {
  readonly statusCode: number;
  readonly error: string;
  readonly message: string;
  readonly requestId: string;
  readonly code: string;
  readonly retryable?: true;
  readonly upstream?: UpstreamSummary;
}

/** The refusal's HTTP body. */
export function refusalBody(request: FastifyRequest, refusal: GateRefusal): GateRefusalBody {
  return {
    statusCode: refusal.status,
    error: STATUS_CODES[refusal.status] ?? 'Error',
    message: refusal.message,
    requestId: request.id,
    code: refusal.code,
    ...(refusal.retryable ? { retryable: true as const } : {}),
    ...(refusal.upstream === undefined ? {} : { upstream: refusal.upstream }),
  };
}

/**
 * `Retry-After` of a retryable refusal, in seconds: Google did not answer the gate's check in time
 * (`SA_GATE_UNAVAILABLE`), or the instance could not get its account's token (`SA_CREDENTIALS_UNAVAILABLE`, which
 * the metadata server usually answers again within seconds).
 */
export const GATE_RETRY_AFTER_SECONDS = 10;

/** Answers a refusal before anything was streamed; `extra` joins the body (the preflight's checklist). */
export function sendRefusal(
  request: FastifyRequest,
  reply: FastifyReply,
  refusal: GateRefusal,
  extra: Readonly<Record<string, unknown>> = {},
): FastifyReply {
  if (refusal.status === 401) return sendUnauthenticated(request, reply, refusal.message);
  if (refusal.retryable) reply.header('retry-after', String(GATE_RETRY_AFTER_SECONDS));
  return reply.code(refusal.status).send({ ...refusalBody(request, refusal), ...extra });
}

/** A refusal in the middle of a stream (the memo ran out and the gate closed). */
export function refusalFrame(refusal: GateRefusal): ErrorFrame {
  return {
    t: 'error',
    message: refusal.message,
    status: refusal.status,
    code: refusal.code,
    ...(refusal.retryable ? { retryable: true } : {}),
  };
}
