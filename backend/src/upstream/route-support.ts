// SPDX-License-Identifier: MIT
/**
 * What the JSON routes that call Google on the caller's behalf share (`/api/scopes/search`, `/api/preflight`):
 * the caller's token and its rate limit, the request's lifetime as an abort signal, and error bodies in the
 * server's shape `{ statusCode, error, message, requestId }`, optionally with what Google answered.
 */
import { STATUS_CODES } from 'node:http';

import type { FastifyReply, FastifyRequest } from 'fastify';
import type * as z from 'zod';

import { callerTokenOf, tokenKeyOf } from '../stream/caller.js';
import type { GoogleCallContext, UpstreamSummary } from './google.js';
import type { UpstreamClient } from './request.js';
import type { TokenRateLimiter } from './token-limit.js';

/** An error answer: the server's error shape, plus Google's answer when one led to it. */
export interface RouteErrorBody {
  readonly statusCode: number;
  readonly error: string;
  readonly message: string;
  readonly requestId: string;
  readonly upstream?: UpstreamSummary;
}

export function sendError(
  request: FastifyRequest,
  reply: FastifyReply,
  statusCode: number,
  message: string,
  upstream?: UpstreamSummary,
): FastifyReply {
  const body: RouteErrorBody = {
    statusCode,
    error: STATUS_CODES[statusCode] ?? 'Error',
    message,
    requestId: request.id,
    ...(upstream === undefined ? {} : { upstream }),
  };
  return reply.code(statusCode).send(body);
}

/** The first schema problem as `field: message`. Messages never echo the value sent. */
export function firstIssue(error: z.ZodError): string {
  const [issue] = error.issues;
  if (issue === undefined) return 'the body is not valid';
  const path = issue.path.map(String).join('.');
  return path === '' ? issue.message : `${path}: ${issue.message}`;
}

export const SIGN_IN_MESSAGE = 'Sign in first: this request needs your Google access token.';
export const SIGN_IN_AGAIN_MESSAGE = 'Google did not accept your sign-in. Sign in again.';

/** Answers 401 with the `WWW-Authenticate` challenge of RFC 6750. */
export function sendUnauthenticated(
  request: FastifyRequest,
  reply: FastifyReply,
  message: string,
): FastifyReply {
  reply.header('www-authenticate', 'Bearer');
  return sendError(request, reply, 401, message);
}

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
    void sendUnauthenticated(request, reply, SIGN_IN_MESSAGE);
    return null;
  }
  const decision = limiter.take(tokenKeyOf(token));
  if (!decision.allowed) {
    reply.header('retry-after', String(decision.retryAfterSeconds));
    void sendError(
      request,
      reply,
      429,
      `Too many requests for this sign-in; retry in ${String(decision.retryAfterSeconds)} s.`,
    );
    return null;
  }
  return token;
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
