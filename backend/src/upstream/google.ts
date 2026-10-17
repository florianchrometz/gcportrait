// SPDX-License-Identifier: MIT
/**
 * The Google calls of the scope picker, the preflight and the service-account gate (docs/permissions.md;
 * AGENTS.md, Security and privacy, Quota project and the permission check; skill cai-ingestion §1), made
 * through the allowlisted client of request.ts (`requestJson`: the four hosts only, no redirect, 60 s,
 * retries) with:
 *
 * - the bearer token forwarded verbatim in `Authorization` (or, for tokeninfo, in the form body, never a URL);
 * - the incoming request's id sent as `x-request-id` and on every log line (`log` is Fastify's request logger);
 * - one log line per call naming a fixed operation, the host, the status, the attempts and the time: never the
 *   URL's path or query (they carry the scope), a header value or a body;
 * - each answer's body capped at {@link UPSTREAM_MAX_BYTES} and parsed here, so callers classify a
 *   {@link GoogleOutcome}, never raw bytes.
 */
import type { FastifyBaseLogger } from 'fastify';
import type * as z from 'zod';

import type { UpstreamSummarySchema } from '../schemas.js';
import { errorDetailOf, isRecord, type GoogleErrorDetail } from './google-error.js';
import {
  requestJson,
  UpstreamExchangeError,
  type ExchangeFailureKind,
  type UpstreamClient,
} from './request.js';
import { scopePath, type ParsedScope } from './scope.js';

// The one parser of Google's error envelope lives in google-error.ts; these are re-exported for the routes.
export { errorDetailOf, isRecord, type ErrorInfo, type GoogleErrorDetail } from './google-error.js';

export const RESOURCE_MANAGER_URL = 'https://cloudresourcemanager.googleapis.com/v3';
export const CLOUD_ASSET_URL = 'https://cloudasset.googleapis.com/v1';
export const TOKEN_INFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

/** 25 MiB per answer (skill cai-ingestion §4). */
export const UPSTREAM_MAX_BYTES = 25 * 1024 * 1024;

/** The incoming request a Google call is made for. */
export interface GoogleCallContext {
  readonly client: UpstreamClient;
  /** Aborts when the incoming request goes away. */
  readonly signal: AbortSignal;
  readonly requestId: string;
  readonly log: FastifyBaseLogger;
}

/** What a Google call came to. */
export type GoogleOutcome =
  | {
      readonly kind: 'answer';
      readonly httpStatus: number;
      /** The parsed JSON body of a 2xx answer (undefined when it was not JSON). */
      readonly body: unknown;
      /** For a status of 400 or more. */
      readonly error?: GoogleErrorDetail;
    }
  | {
      readonly kind: 'failure';
      /**
       * No answer: no answer in time, none at all, or one too large to read (after the retries). (`busy` needs a
       * memory claim, which only the live pull's pages ask for, never these calls.)
       */
      readonly failure: ExchangeFailureKind;
      readonly message: string;
    };

/**
 * What the browser is told about an upstream answer (status, canonical code, reason, Google's message):
 * `UpstreamSummarySchema` of ../schemas.ts, declared once.
 */
export type UpstreamSummary = Readonly<z.infer<typeof UpstreamSummarySchema>>;

/** The reason of the answer's only ErrorInfo; undefined with none, with several, or for another outcome. */
export function soleReason(outcome: GoogleOutcome): string | undefined {
  if (outcome.kind !== 'answer' || outcome.error === undefined) return undefined;
  const [info, ...more] = outcome.error.infos;
  return info !== undefined && more.length === 0 ? info.reason : undefined;
}

/** The outcome as the browser sees it. */
export function summaryOf(outcome: GoogleOutcome): UpstreamSummary {
  if (outcome.kind === 'failure')
    return { status: 0, code: outcome.failure.toUpperCase().replace('-', '_'), message: outcome.message };
  const reason = soleReason(outcome);
  const error = outcome.error;
  return {
    status: outcome.httpStatus,
    ...(error?.status === undefined ? {} : { code: error.status }),
    ...(reason === undefined || reason === '' ? {} : { reason }),
    ...(error?.message === undefined ? {} : { message: error.message }),
  };
}

/** Whether the outcome is transient after the retries: 429, 5xx, no answer in time, or no answer at all. */
export function isTransientOutcome(outcome: GoogleOutcome): boolean {
  if (outcome.kind === 'failure') return outcome.failure !== 'too-large';
  return outcome.httpStatus === 429 || outcome.httpStatus >= 500;
}

/** Google refused the token itself (expired, revoked, not a Google access token): the person signs in again. */
export function isUnauthenticated(outcome: GoogleOutcome): boolean {
  return outcome.kind === 'answer' && outcome.httpStatus === 401;
}

/** The token lacks the OAuth scope the API needs: the person signs in again, allowing it. */
export function isScopeInsufficient(outcome: GoogleOutcome): boolean {
  return (
    outcome.kind === 'answer' &&
    outcome.httpStatus === 403 &&
    soleReason(outcome) === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT'
  );
}

interface GoogleCall {
  /** A fixed name for the log line. */
  readonly operation: string;
  readonly method: 'GET' | 'POST';
  readonly url: string;
  /** Sent as `Authorization: Bearer …`; null for tokeninfo, which takes the token in its form body. */
  readonly token: string | null;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** Fewer attempts than the client's policy (interactive calls). */
  readonly attempts?: number;
}

/** Makes one Google call (with the client's retries) and reads its answer. Rethrows only the caller's abort. */
export async function callGoogle(context: GoogleCallContext, call: GoogleCall): Promise<GoogleOutcome> {
  const host = new URL(call.url).hostname;
  const client =
    call.attempts === undefined
      ? context.client
      : { ...context.client, retry: { ...context.client.retry, attempts: call.attempts } };
  const headers: Record<string, string> = { ...call.headers, 'x-request-id': context.requestId };
  if (call.token !== null) headers.authorization = `Bearer ${call.token}`;
  const started = Date.now();
  try {
    const answer = await requestJson(
      client,
      {
        url: call.url,
        method: call.method,
        headers,
        ...(call.body === undefined ? {} : { body: call.body }),
      },
      {
        signal: context.signal,
        maxBytes: UPSTREAM_MAX_BYTES,
        onRetry: (event) => {
          context.log.warn({ upstream: { operation: call.operation, host, ...event } }, 'retrying upstream');
        },
      },
    );
    context.log.info(
      {
        upstream: {
          operation: call.operation,
          host,
          status: answer.status,
          attempts: answer.attempts,
          ms: Date.now() - started,
        },
      },
      'upstream call',
    );
    if (answer.status >= 400)
      return {
        kind: 'answer',
        httpStatus: answer.status,
        body: undefined,
        error: errorDetailOf(answer.body),
      };
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(answer.body));
    } catch {
      body = undefined;
    }
    return { kind: 'answer', httpStatus: answer.status, body };
  } catch (error) {
    if (!(error instanceof UpstreamExchangeError)) throw error;
    context.log.warn(
      {
        upstream: {
          operation: call.operation,
          host,
          failure: error.kind,
          attempts: error.attempts,
          ms: Date.now() - started,
        },
      },
      'upstream call failed',
    );
    return { kind: 'failure', failure: error.kind, message: error.message };
  }
}

/** Resource Manager `GET /v3/{scope}` (preflight step 1, gate steps 1 and 2). */
export function getScope(
  context: GoogleCallContext,
  scope: ParsedScope,
  token: string,
): Promise<GoogleOutcome> {
  return callGoogle(context, {
    operation: `resourcemanager.${scope.kind}s.get`,
    method: 'GET',
    url: `${RESOURCE_MANAGER_URL}/${scopePath(scope)}`,
    token,
  });
}

/**
 * CAI `assets.list` with `pageSize: 1` (preflight probe): POST with the method override and a JSON body (skill
 * §1), the quota project in `x-goog-user-project` when one is given (user mode; never in SA mode).
 */
export function probeAssets(
  context: GoogleCallContext,
  scope: ParsedScope,
  token: string,
  quotaProject: string | null,
): Promise<GoogleOutcome> {
  return callGoogle(context, {
    operation: 'cloudasset.assets.list',
    method: 'POST',
    url: `${CLOUD_ASSET_URL}/${scopePath(scope)}/assets`,
    token,
    headers: {
      'content-type': 'application/json',
      'x-http-method-override': 'GET',
      ...(quotaProject === null ? {} : { 'x-goog-user-project': quotaProject }),
    },
    body: JSON.stringify({ contentType: 'RESOURCE', pageSize: 1 }),
  });
}

/** What tokeninfo says about the caller's token: its email (when the token carries one), or that it is invalid. */
export type TokenFacts =
  | {
      readonly kind: 'valid';
      readonly email?: string;
      /** Seconds the token has left (tokeninfo's `expires_in`), when Google says. */
      readonly expiresIn?: number;
    }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unknown' };

/**
 * `POST https://oauth2.googleapis.com/tokeninfo` with the token in the form body (never in a URL). Only the email
 * is kept, to fill the `--member` of the commands; it is neither stored nor logged. A 400 means the token is not
 * valid; anything else unexpected leaves the email unknown.
 */
export async function tokenFacts(context: GoogleCallContext, token: string): Promise<TokenFacts> {
  const outcome = await callGoogle(context, {
    operation: 'oauth2.tokeninfo',
    method: 'POST',
    url: TOKEN_INFO_URL,
    token: null,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: token }).toString(),
    attempts: 2,
  });
  if (outcome.kind === 'answer' && outcome.httpStatus === 400) return { kind: 'invalid' };
  if (outcome.kind !== 'answer' || outcome.httpStatus !== 200 || !isRecord(outcome.body))
    return { kind: 'unknown' };
  const { email, expires_in: expiresIn } = outcome.body;
  const seconds = typeof expiresIn === 'string' || typeof expiresIn === 'number' ? Number(expiresIn) : NaN;
  return {
    kind: 'valid',
    ...(typeof email === 'string' ? { email } : {}),
    ...(Number.isFinite(seconds) && seconds >= 0 ? { expiresIn: seconds } : {}),
  };
}
