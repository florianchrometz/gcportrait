// SPDX-License-Identifier: MIT
/**
 * Requests to Google on the caller's behalf (docs/security.md §1, §4 and §5): only to the
 * allowlisted hosts (allowlist.ts), each attempt bounded by the upstream timeout (60 s) and each answer's body by
 * a byte cap, transient answers retried with backoff and jitter (retry.ts). The caller's abort signal (the
 * client went away) stops everything at once, including a backoff wait.
 *
 * Nothing here logs, and nothing here sees more than it forwards: the headers a caller passes (the bearer token,
 * the quota project) go to `fetch` and nowhere else.
 */
import { allowedUpstreamUrl } from './allowlist.js';
import { readBody, readerOf, type ByteReader } from './body.js';
import {
  DEFAULT_RETRY_POLICY,
  backoffDelay,
  isRetryableStatus,
  sleep as timerSleep,
  type RetryPolicy,
  type Sleep,
} from './retry.js';

/** The `fetch` the backend calls Google with; tests pass a mock that plays the Google API. */
export type UpstreamFetch = (url: string, init: RequestInit) => Promise<Response>;

/** The longest one upstream attempt may take: the whole exchange for a JSON answer, idle time for a stream. */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 60_000;

export interface UpstreamOptions {
  readonly fetch?: UpstreamFetch;
  readonly sleep?: Sleep;
  /** Numbers in [0, 1) for the jitter. */
  readonly random?: () => number;
  readonly retry?: RetryPolicy;
  readonly timeoutMs?: number;
}

/** How the backend talks to Google; one per server. */
export interface UpstreamClient {
  readonly fetch: UpstreamFetch;
  readonly sleep: Sleep;
  readonly random: () => number;
  readonly retry: RetryPolicy;
  readonly timeoutMs: number;
}

export function createUpstreamClient(options: UpstreamOptions = {}): UpstreamClient {
  return {
    fetch: options.fetch ?? ((url, init) => fetch(url, init)),
    sleep: options.sleep ?? timerSleep,
    random: options.random ?? Math.random,
    retry: options.retry ?? DEFAULT_RETRY_POLICY,
    timeoutMs: options.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS,
  };
}

export interface UpstreamRequest {
  /** Must be on an allowlisted host; checked before anything is sent. */
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
}

/**
 * Why an attempt produced no usable answer: no answer in time, no answer at all, one too large to read, or one this
 * process had no memory budget for at the moment (`busy`, ../stream/page-budget.ts; retried like a timeout).
 */
export type ExchangeFailureKind = 'timeout' | 'transport' | 'too-large' | 'busy';

export class UpstreamExchangeError extends Error {
  override readonly name = 'UpstreamExchangeError';
  readonly kind: ExchangeFailureKind;
  /** Attempts made, the failing one included. */
  attempts = 1;

  constructor(kind: ExchangeFailureKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

/**
 * A share of a process-wide memory budget that grows as an answer's bytes arrive (../stream/page-budget.ts). The
 * client takes each chunk's bytes before keeping it; a refusal fails the attempt as `busy`.
 */
export interface ByteClaim {
  /** Adds `bytes` to the claim; false (and nothing added) when the budget cannot hold them. */
  take(bytes: number): boolean;
  /** Gives the claim back; idempotent. */
  release(): void;
}

/** A complete answer: any status, its body read in full under the byte cap. */
export interface UpstreamAnswer {
  readonly status: number;
  readonly headers: Headers;
  readonly body: Uint8Array;
  /** Attempts made, this one included. */
  readonly attempts: number;
  /**
   * The memory claim of a 2xx answer's body, when the request asked for one ({@link ExchangeOptions.claim}): still
   * held, for the caller to release once it no longer keeps the body or what it made of it. Error answers and
   * failed attempts give theirs back at once.
   */
  readonly claim?: ByteClaim;
}

/** A retry about to be waited for, for the request log. */
export interface RetryEvent {
  /** The attempt that failed, from 1. */
  readonly attempt: number;
  readonly delayMs: number;
  /** The transient HTTP status, or the kind of failure when there was no answer. */
  readonly status?: number;
  readonly failure?: ExchangeFailureKind;
}

export interface ExchangeOptions {
  /** Aborts when the client goes away; the abort reason is rethrown as it is. */
  readonly signal: AbortSignal;
  /** The largest body read (a JSON answer, or an error answer next to a stream). */
  readonly maxBytes: number;
  readonly onRetry?: (event: RetryEvent) => void;
  /** A fresh memory claim per attempt, for {@link requestJson}'s body (the live pull's pages). */
  readonly claim?: () => ByteClaim;
}

/** An attempt's own controller: aborted by the caller's signal or by the attempt's timer. */
interface Attempt {
  readonly signal: AbortSignal;
  /** (Re)starts the timer: once per attempt for a JSON answer, on every chunk for a stream. */
  arm(): void;
  dispose(): void;
}

function startAttempt(parent: AbortSignal, timeoutMs: number): Attempt {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onAbort = (): void => {
    controller.abort(parent.reason);
  };
  if (parent.aborted) controller.abort(parent.reason);
  else parent.addEventListener('abort', onAbort, { once: true });
  const arm = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      controller.abort(
        new UpstreamExchangeError(
          'timeout',
          `Google did not answer within ${String(Math.round(timeoutMs / 1000))} s.`,
        ),
      );
    }, timeoutMs);
  };
  arm();
  return {
    signal: controller.signal,
    arm,
    dispose() {
      if (timer !== undefined) clearTimeout(timer);
      parent.removeEventListener('abort', onAbort);
    },
  };
}

/** What a rejected fetch or read means: the client left (rethrown as is), a timeout, or a transport failure. */
function failureOf(error: unknown, parent: AbortSignal, attempt: Attempt): unknown {
  if (parent.aborted) return parent.reason;
  const reason: unknown = attempt.signal.aborted ? attempt.signal.reason : undefined;
  if (reason instanceof UpstreamExchangeError) return reason;
  if (error instanceof UpstreamExchangeError) return error;
  return new UpstreamExchangeError('transport', 'Google could not be reached.');
}

function busy(): UpstreamExchangeError {
  return new UpstreamExchangeError(
    'busy',
    'This gcportrait instance is reading too many large answers at once.',
  );
}

function tooLarge(maxBytes: number): UpstreamExchangeError {
  const mib = maxBytes / (1024 * 1024);
  const limit = Number.isInteger(mib) ? `${String(mib)} MiB` : `${String(maxBytes)} bytes`;
  return new UpstreamExchangeError('too-large', `Google's answer is larger than ${limit}.`);
}

/**
 * Reads a body in full, stopping (and cancelling the transfer) once it exceeds `maxBytes`, or once `claim` cannot
 * hold the next chunk.
 */
async function readCapped(response: Response, maxBytes: number, claim?: ByteClaim): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooLarge(maxBytes);
  }
  return readBody(response, (bytes, total) => {
    if (total > maxBytes) throw tooLarge(maxBytes);
    if (claim !== undefined && !claim.take(bytes)) throw busy();
  });
}

/**
 * A redirect is never followed: `manual` hands the 3xx answer back as it is, so it is an answer like any other
 * status (never retried, classified as unexpected by its caller) and nothing goes to where it points. (`error`
 * would refuse it too, but as a rejected fetch indistinguishable from a network failure, which was retried five
 * times as one.)
 */
function initOf(request: UpstreamRequest, signal: AbortSignal): RequestInit {
  return {
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
    signal,
    redirect: 'manual',
  };
}

/**
 * Runs `attemptOnce` up to `policy.attempts` times. An attempt returns `{ retry: status }` for a transient
 * answer, the result otherwise; a timeout or transport failure is retried too, a too-large answer is not.
 */
async function withRetries<T>(
  client: UpstreamClient,
  options: Pick<ExchangeOptions, 'signal' | 'onRetry'>,
  attemptOnce: (
    attempt: number,
  ) => Promise<{ readonly done: T } | { readonly retry: number; readonly last: T }>,
): Promise<T> {
  const { attempts } = client.retry;
  for (let attempt = 1; ; attempt += 1) {
    let outcome: { readonly done: T } | { readonly retry: number; readonly last: T };
    try {
      outcome = await attemptOnce(attempt);
    } catch (error) {
      const transient =
        error instanceof UpstreamExchangeError && error.kind !== 'too-large' && attempt < attempts;
      if (!transient) {
        if (error instanceof UpstreamExchangeError) error.attempts = attempt;
        throw error;
      }
      const delayMs = backoffDelay(attempt, client.random, client.retry);
      options.onRetry?.({ attempt, delayMs, failure: error.kind });
      await client.sleep(delayMs, options.signal);
      continue;
    }
    if ('done' in outcome) return outcome.done;
    if (attempt >= attempts) return outcome.last;
    const delayMs = backoffDelay(attempt, client.random, client.retry);
    options.onRetry?.({ attempt, delayMs, status: outcome.retry });
    await client.sleep(delayMs, options.signal);
  }
}

/**
 * Sends a request and reads the whole answer, retrying transient ones (429, 5xx, timeouts, transport failures, a
 * busy memory budget) by the client's policy. Resolves with the final answer, whatever its status (a transient
 * status after the last attempt included); rejects with an {@link UpstreamExchangeError} when no answer could be
 * read, or with the signal's reason when the caller aborted. With `options.claim`, a 2xx answer comes back with its
 * memory claim still held (the caller releases it); every other attempt's claim is given back here.
 */
export async function requestJson(
  client: UpstreamClient,
  request: UpstreamRequest,
  options: ExchangeOptions,
): Promise<UpstreamAnswer> {
  const url = allowedUpstreamUrl(request.url).href;
  return withRetries(client, options, async (attempts) => {
    const attempt = startAttempt(options.signal, client.timeoutMs);
    const claim = options.claim?.();
    let kept = false;
    try {
      const response = await client.fetch(url, initOf(request, attempt.signal));
      const body = await readCapped(response, options.maxBytes, claim);
      kept = claim !== undefined && response.ok;
      const answer: UpstreamAnswer = {
        status: response.status,
        headers: response.headers,
        body,
        attempts,
        ...(kept && claim !== undefined ? { claim } : {}),
      };
      return isRetryableStatus(response.status) ? { retry: response.status, last: answer } : { done: answer };
    } catch (error) {
      throw failureOf(error, options.signal, attempt);
    } finally {
      if (!kept) claim?.release();
      attempt.dispose();
    }
  });
}

/** An answer whose body is read as it arrives. */
export interface UpstreamStream {
  readonly status: number;
  readonly headers: Headers;
  /** The body's chunks; a pause longer than the timeout ends it with an {@link UpstreamExchangeError}. */
  readonly body: AsyncIterable<Uint8Array>;
  readonly attempts: number;
}

/**
 * Opens a streamed answer. A 2xx answer resolves as an {@link UpstreamStream}, its body unread; any other final
 * answer is read in full (under `maxBytes`) as an {@link UpstreamAnswer}, for its error message. Transient
 * answers are retried as in {@link requestJson}, but only before the body is handed over: once a caller reads a
 * stream, a failure ends it.
 */
export type OpenedStream =
  | { readonly ok: true; readonly stream: UpstreamStream }
  | { readonly ok: false; readonly answer: UpstreamAnswer };

export async function openStream(
  client: UpstreamClient,
  request: UpstreamRequest,
  options: ExchangeOptions,
): Promise<OpenedStream> {
  const url = allowedUpstreamUrl(request.url).href;
  return withRetries<OpenedStream>(client, options, async (attempts) => {
    const attempt = startAttempt(options.signal, client.timeoutMs);
    let handedOver = false;
    try {
      const response = await client.fetch(url, initOf(request, attempt.signal));
      if (response.ok) {
        handedOver = true;
        const stream: UpstreamStream = {
          status: response.status,
          headers: response.headers,
          body: streamBody(response, attempt, options.signal),
          attempts,
        };
        return { done: { ok: true as const, stream } };
      }
      const body = await readCapped(response, options.maxBytes);
      const answer: UpstreamAnswer = { status: response.status, headers: response.headers, body, attempts };
      return isRetryableStatus(response.status)
        ? { retry: response.status, last: { ok: false as const, answer } }
        : { done: { ok: false as const, answer } };
    } catch (error) {
      throw failureOf(error, options.signal, attempt);
    } finally {
      if (!handedOver) attempt.dispose();
    }
  });
}

/** The body of a streamed answer, with the attempt's timer re-armed on every chunk (an idle timeout). */
async function* streamBody(
  response: Response,
  attempt: Attempt,
  parent: AbortSignal,
): AsyncGenerator<Uint8Array, void, undefined> {
  const reader = readerOf(response);
  try {
    if (reader === undefined) return;
    for (;;) {
      let result: Awaited<ReturnType<ByteReader['read']>>;
      try {
        result = await reader.read();
      } catch (error) {
        throw failureOf(error, parent, attempt);
      }
      if (result.done) return;
      attempt.arm();
      yield result.value;
    }
  } finally {
    attempt.dispose();
    if (reader !== undefined) {
      // Stopped early (the client left, a cap): let go of the upstream transfer.
      await reader.cancel().catch(() => undefined);
    }
  }
}
