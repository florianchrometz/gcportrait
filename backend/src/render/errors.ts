// SPDX-License-Identifier: MIT
/**
 * The render API's error answers (agents.md, Exports and the render API): the server's shape plus the fields
 * the gate's refusal body already has, `{ statusCode, error, message, requestId, code, retryable?, reason?,
 * upstream? }`, always sent before any byte of an image. `code` says what happened in a word a script can
 * test; `reason` is Google's `ErrorInfo` reason when a pull's error frame carried one; `upstream` is Google's
 * own status and code when Google's answer led to it. An answer with `retryable: true` carries `Retry-After`
 * (its own delay, else {@link DEFAULT_RETRY_AFTER_SECONDS}), and so does every 429.
 *
 * Answers the shared helpers give without a code (the token's 401 and 429, the schema's 400, Fastify's 413 and 415,
 * the service-account checks' 403 and 501) get the code of their status (`DEFAULT_CODES`) on the way out, so every
 * error of the route carries one.
 */
import { STATUS_CODES } from 'node:http';

import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ErrorFrame } from '../stream/frames.js';
import type { RenderJobError } from './runner.js';

/** The code of an error answer that came without one, by its status. */
export const DEFAULT_CODES: Readonly<Record<number, string>> = {
  400: 'INVALID_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'SA_MODE_OFF',
  404: 'NOT_FOUND',
  408: 'REQUEST_TIMEOUT',
  413: 'BODY_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
  500: 'INTERNAL',
  501: 'SA_MODE_UNAVAILABLE',
};

/** Seconds a client waits before trying again after `RENDER_BUSY`. */
export const RENDER_BUSY_RETRY_SECONDS = 10;

/** `Retry-After` of a retryable answer that names no delay of its own (Google's or the gate's 5xx, a cut pull). */
export const DEFAULT_RETRY_AFTER_SECONDS = 10;

/** How an upload is sent, for the messages of the answers that refuse one. */
export const UPLOAD_SHAPE =
  'An upload is multipart/form-data: the request field (the JSON document) first, then the file part.';

/** One error answer of the route. */
export interface RenderFailure {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly reason?: string;
  /** Google's own status and canonical code, when its answer led to this one. */
  readonly upstream?: { readonly status: number; readonly code?: string };
  /** Seconds for `Retry-After`; a retryable answer without one gets {@link DEFAULT_RETRY_AFTER_SECONDS}. */
  readonly retryAfter?: number;
}

export function sendFailure(
  request: FastifyRequest,
  reply: FastifyReply,
  failure: RenderFailure,
): FastifyReply {
  const retryAfter =
    failure.retryAfter ?? (failure.retryable === true ? DEFAULT_RETRY_AFTER_SECONDS : undefined);
  if (retryAfter !== undefined) reply.header('retry-after', String(retryAfter));
  const body = {
    statusCode: failure.status,
    error: STATUS_CODES[failure.status] ?? 'Error',
    message: failure.message,
    requestId: request.id,
    code: failure.code,
    ...(failure.retryable === true ? { retryable: true } : {}),
    ...(failure.reason === undefined ? {} : { reason: failure.reason }),
    ...(failure.upstream === undefined ? {} : { upstream: failure.upstream }),
  };
  if (failure.status === 401) {
    reply.header('www-authenticate', 'Bearer');
  }
  return reply.code(failure.status).send(body);
}

/** Codes of the error frames the backend writes itself: the pull's (stream/asset-list.ts) and the gate's (`SA_…`). */
const OWN_FRAME_CODES = new Set([
  'UPSTREAM_TIMEOUT',
  'UPSTREAM_UNREACHABLE',
  'RESPONSE_TOO_LARGE',
  'INSTANCE_BUSY',
  'BAD_UPSTREAM_ANSWER',
]);

/**
 * The HTTP answer for a pull's `error` frame: the status and code it carries (Google's after the retries, the
 * gate's refusal, or the backend's own), Google's `ErrorInfo` reason, and Google's message verbatim. A server error
 * of Google's becomes 502 with Google's status in `upstream`, so 500 stays this server's own.
 */
export function frameFailure(frame: ErrorFrame): RenderFailure {
  const status = frame.status ?? 502;
  const code = frame.code ?? 'UPSTREAM_ERROR';
  const googles = !OWN_FRAME_CODES.has(code) && !code.startsWith('SA_') && status >= 500;
  return {
    status: googles ? 502 : status,
    code,
    message: frame.message,
    ...(frame.retryable === true ? { retryable: true } : {}),
    ...(frame.reason === undefined ? {} : { reason: frame.reason }),
    ...(googles ? { upstream: { status, code } } : {}),
    ...(code === 'INSTANCE_BUSY' ? { retryAfter: 30 } : {}),
  };
}

/** A thrown value's HTTP status, if it carries one (Fastify's and the multipart reader's errors do). */
function statusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('statusCode' in error)) return undefined;
  const { statusCode } = error;
  return typeof statusCode === 'number' ? statusCode : undefined;
}

/**
 * The answer for an upload whose body could not be read, from the error it failed with: 408 when it was still
 * arriving at the server's body deadline (`bodyTimeoutMs`, server.ts), 413 past a limit of the multipart reader, and
 * 400 for anything else, which is a malformed body (no boundary, a part or the form cut short, a broken header).
 * Never a 500: the body is the client's.
 */
export function uploadFailure(error: unknown, bodyTimeoutMs: number): RenderFailure {
  const status = statusOf(error);
  if (status === 408)
    return {
      status: 408,
      code: 'REQUEST_TIMEOUT',
      message:
        `The upload did not arrive within ${String(bodyTimeoutMs / 1000)} s, this instance's limit for a ` +
        'request body. Send a smaller file, or read the scope with the scope source.',
    };
  if (status === 413)
    return {
      status: 413,
      code: 'BODY_TOO_LARGE',
      message: 'The upload is larger than this instance accepts (RENDER_MAX_BODY_BYTES).',
    };
  if (status !== undefined && status >= 400 && status < 500 && DEFAULT_CODES[status] !== undefined)
    return {
      status,
      code: DEFAULT_CODES[status] ?? 'INVALID_REQUEST',
      message: `The multipart body could not be read. ${UPLOAD_SHAPE}`,
    };
  return {
    status: 400,
    code: 'INVALID_REQUEST',
    message:
      'The multipart body could not be read: it has no boundary, or it ends before its parts do. ' +
      UPLOAD_SHAPE,
  };
}

/** The message for more assets than the instance allows (the render library says the same in the worker). */
export function tooManyAssetsMessage(limit: number): string {
  return (
    `The data holds more than ${limit.toLocaleString('en')} assets, this instance's limit for a render. ` +
    'Narrow it (a smaller scope, or assetTypes for a pull).'
  );
}

/** The HTTP answer for a failed render job. */
export function jobFailure(
  error: RenderJobError,
  source: 'scope' | 'ndjson' | 'bundle' | 'demo',
): RenderFailure {
  switch (error.code) {
    case 'INVALID_FILE':
    case 'EMPTY_SNAPSHOT':
    case 'TOO_MANY_ASSETS':
    case 'VIEW_REFUSED':
      return { status: 422, code: error.code, message: error.message };
    case 'UPSTREAM':
      // A saved stream that ends with Google's error, uploaded as NDJSON: the file holds no snapshot.
      return {
        status: 422,
        code: 'INVALID_FILE',
        message: `The file ends with an error from Google instead of its last frame: ${error.message}`,
        ...(error.upstream?.reason === undefined ? {} : { reason: error.upstream.reason }),
      };
    case 'CUT_SHORT':
      return source === 'scope'
        ? { status: 502, code: 'BAD_UPSTREAM_ANSWER', message: error.message, retryable: true }
        : { status: 422, code: 'INVALID_FILE', message: error.message };
    case 'RENDER_TOO_LARGE':
      return { status: 503, code: 'RENDER_TOO_LARGE', message: error.message };
    case 'INTERNAL':
      return { status: 500, code: 'INTERNAL', message: 'Internal error.' };
  }
}
