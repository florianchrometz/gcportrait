// SPDX-License-Identifier: Apache-2.0
/**
 * What the routes that call Google on the caller's behalf share: the caller's token and its rate limit, a stream
 * slot for the token, the schema's first problem as a message, and the request's lifetime as an abort signal.
 * Their error answers are the server's one shape (../errors.ts).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type * as z from 'zod';

import { sendError, type ErrorAnswer } from '../errors.js';
import { callerTokenOf, tokenKeyOf } from '../stream/caller.js';
import { STREAMS_BUSY_RETRY_SECONDS, type StreamSlots } from '../stream/slots.js';
import type { GoogleCallContext } from './google.js';
import type { UpstreamClient } from './request.js';
import type { TokenRateLimiter } from './token-limit.js';

/** The first schema problem as `field: message`. Messages never echo the value sent. */
export function firstIssue(error: z.ZodError): string {
  const [issue] = error.issues;
  if (issue === undefined) return 'the body is not valid';
  const path = issue.path.map(String).join('.');
  return path === '' ? issue.message : `${path}: ${issue.message}`;
}

/** The 400 of a body that does not fit the route's schema, naming its first problem ({@link firstIssue}). */
export function invalidRequest(error: z.ZodError): ErrorAnswer & { readonly code: string } {
  return { status: 400, code: 'INVALID_REQUEST', message: `Invalid request: ${firstIssue(error)}.` };
}

export const SIGN_IN_MESSAGE = 'Sign in first: this request needs your Google access token.';
export const SIGN_IN_AGAIN_MESSAGE = 'Google did not accept your sign-in. Sign in again.';

/**
 * The caller's token, after its rate limit; or null when the reply has been sent (401 without a token, 429 over
 * the limit).
 */
export function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  limiter: TokenRateLimiter,
): string | null {
  const token = callerTokenOf(request);
  if (token === null) {
    void sendError(request, reply, { status: 401, message: SIGN_IN_MESSAGE });
    return null;
  }
  const decision = limiter.take(tokenKeyOf(token));
  if (!decision.allowed) {
    void sendError(request, reply, {
      status: 429,
      message: `Too many requests for this sign-in; retry in ${String(decision.retryAfterSeconds)} s.`,
      retryAfter: decision.retryAfterSeconds,
    });
    return null;
  }
  return token;
}

/**
 * A stream slot for the caller's token (../stream/slots.ts: four at once, shared by the pulls, the export reads
 * and the renders of a scope): the function that gives it back, or null when the 429 `STREAMS_BUSY` has been sent.
 */
export function takeStreamSlot(
  request: FastifyRequest,
  reply: FastifyReply,
  slots: StreamSlots,
  token: string,
): (() => void) | null {
  const release = slots.acquire(tokenKeyOf(token));
  if (release === null)
    void sendError(request, reply, {
      status: 429,
      code: 'STREAMS_BUSY',
      message: `${String(slots.limit)} asset streams are already running for this sign-in. Wait for one to finish, then try again.`,
      retryable: true,
      retryAfter: STREAMS_BUSY_RETRY_SECONDS,
    });
  return release;
}

/**
 * The context of the Google calls made for one request. Its signal aborts when the client goes away before the
 * answer is sent, so no upstream call outlives the request that asked for it.
 */
export function googleContextFor(
  request: FastifyRequest,
  reply: FastifyReply,
  client: UpstreamClient,
): GoogleCallContext {
  const controller = new AbortController();
  reply.raw.once('close', () => {
    if (!reply.raw.writableFinished) controller.abort(new Error('The client went away.'));
  });
  return { client, signal: controller.signal, requestId: request.id, log: request.log };
}
