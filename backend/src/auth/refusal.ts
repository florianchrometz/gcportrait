// SPDX-License-Identifier: Apache-2.0
/**
 * How a refusal of the service-account gate (./gate.ts) reaches the caller, the same on every route that takes
 * `mode: "sa"`: before anything is streamed, as an HTTP error in the server's one shape (../errors.ts) with the
 * gate's `code`, `retryable` and Google's answer when one led to it (401 with the RFC 6750 challenge, 403 refused,
 * 503 try again, with `Retry-After`); in the middle of a stream, as an `error` frame.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import { sendError } from '../errors.js';
import type { ErrorFrame } from '../stream/frames.js';
import type { GateRefusal } from './gate.js';

/**
 * `Retry-After` of a retryable refusal, in seconds: Google did not answer the gate's check in time
 * (`SA_GATE_UNAVAILABLE`), or the instance could not get its account's token (`SA_CREDENTIALS_UNAVAILABLE`, which
 * the metadata server usually answers again within seconds).
 */
export const GATE_RETRY_AFTER_SECONDS = 10;

/**
 * Answers a refusal before anything was streamed; `extra` joins the body (the preflight's checklist). A 401 is the
 * sign-in answer every route gives, with nothing else of the refusal.
 */
export function sendRefusal(
  request: FastifyRequest,
  reply: FastifyReply,
  refusal: GateRefusal,
  extra: Readonly<Record<string, unknown>> = {},
): FastifyReply {
  if (refusal.status === 401)
    return sendError(request, reply, { status: 401, code: refusal.code, message: refusal.message });
  return sendError(request, reply, {
    status: refusal.status,
    code: refusal.code,
    message: refusal.message,
    ...(refusal.retryable ? { retryable: true, retryAfter: GATE_RETRY_AFTER_SECONDS } : {}),
    ...(refusal.upstream === undefined ? {} : { upstream: refusal.upstream }),
    extra,
  });
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
