// SPDX-License-Identifier: Apache-2.0
/**
 * The server's one error answer (docs/api.md, Errors), for every route, the error handler, the handler of
 * unknown paths and the rate limiter: `{ statusCode, error, message, requestId, code, retryable?, reason?,
 * upstream? }` (`ErrorResponseSchema`, ./schemas.ts). `code` says what happened in a word a script can test: the
 * one the caller names, else its status's ({@link DEFAULT_CODES}). `message` is for people and never echoes a
 * value the request sent (docs/security.md §2). `reason` is Google's `ErrorInfo` reason and `upstream` Google's
 * own answer, when one led to this one.
 *
 * Headers: every 401 carries the RFC 6750 challenge (`WWW-Authenticate: Bearer`); an answer with a delay of its
 * own, or with `retryable: true`, carries `Retry-After` ({@link DEFAULT_RETRY_AFTER_SECONDS} when it names none).
 */
import { STATUS_CODES } from 'node:http';

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ErrorResponse } from './schemas.js';

/**
 * The code of an answer that names none, by its status: the statuses whose meaning is the same on every route.
 * Any other status names its code (`SA_MODE_OFF`, `RENDER_TIMEOUT`, …), or gets {@link FALLBACK_CODE}.
 */
export const DEFAULT_CODES: Readonly<Partial<Record<number, string>>> = {
  400: 'INVALID_REQUEST',
  401: 'UNAUTHENTICATED',
  404: 'NOT_FOUND',
  408: 'REQUEST_TIMEOUT',
  413: 'BODY_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
  500: 'INTERNAL',
};

/** The code of an answer whose status {@link DEFAULT_CODES} does not name and that names none itself. */
export const FALLBACK_CODE = 'ERROR';

/** `Retry-After` of a retryable answer that names no delay of its own, in seconds. */
export const DEFAULT_RETRY_AFTER_SECONDS = 10;

/** One error answer: what the body says, and the headers that go with it. */
export interface ErrorAnswer {
  readonly status: number;
  readonly message: string;
  /** Default: the status's ({@link DEFAULT_CODES}). */
  readonly code?: string;
  readonly retryable?: boolean;
  /** Seconds for `Retry-After`; a retryable answer without one gets {@link DEFAULT_RETRY_AFTER_SECONDS}. */
  readonly retryAfter?: number;
  readonly reason?: string;
  readonly upstream?: NonNullable<ErrorResponse['upstream']>;
  /** Fields that join the body after the error fields (the preflight's checklist). */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** The code an answer of `status` gets when it names none. */
export function defaultCodeOf(status: number): string {
  return DEFAULT_CODES[status] ?? FALLBACK_CODE;
}

/** The answer's body, without `extra`: for the rate limiter, which throws it for the error handler to send. */
export function errorBody(request: FastifyRequest, answer: ErrorAnswer): ErrorResponse {
  return {
    statusCode: answer.status,
    error: STATUS_CODES[answer.status] ?? 'Error',
    message: answer.message,
    requestId: request.id,
    code: answer.code ?? defaultCodeOf(answer.status),
    ...(answer.retryable === true ? { retryable: true as const } : {}),
    ...(answer.reason === undefined ? {} : { reason: answer.reason }),
    ...(answer.upstream === undefined ? {} : { upstream: answer.upstream }),
  };
}

/** Sends the answer with its headers. */
export function sendError(request: FastifyRequest, reply: FastifyReply, answer: ErrorAnswer): FastifyReply {
  const retryAfter =
    answer.retryAfter ?? (answer.retryable === true ? DEFAULT_RETRY_AFTER_SECONDS : undefined);
  if (retryAfter !== undefined) reply.header('retry-after', String(retryAfter));
  if (answer.status === 401) reply.header('www-authenticate', 'Bearer');
  return reply.code(answer.status).send({ ...errorBody(request, answer), ...answer.extra });
}

/** Whether a thrown value is an answer this module built (the rate limiter's). */
export function isErrorResponse(value: unknown): value is ErrorResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'statusCode' in value &&
    'error' in value &&
    'message' in value &&
    'requestId' in value &&
    'code' in value
  );
}
