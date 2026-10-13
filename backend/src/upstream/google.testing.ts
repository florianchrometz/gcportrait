// SPDX-License-Identifier: MIT
/**
 * What every pretend Google of the backend's tests shares (never built into dist/: tsconfig.build.json leaves
 * `*.testing.ts` out): the synthetic credentials, the recorded call, Google's answer shapes (JSON, the error
 * envelope of skill cai-ingestion §9, the HTML error page), streamed bodies, an upstream client that never
 * sleeps, Cloud Asset Inventory's pager and the instance's identity. The fakes of single APIs build on it:
 * ../preflight/google.testing.ts (Resource Manager, tokeninfo and the gate's answers) and
 * ../stream/google.testing.ts (synthetic assets, Cloud Asset Inventory and Cloud Storage). Everything is
 * synthetic (AGENTS.md, Security and privacy, principle 6): `demo-` project ids, numbers below 100000000000,
 * example.com.
 */
import pino from 'pino';
import { vi, type Mock } from 'vitest';

import type { ServiceAccountIdentity } from '../auth/identity.js';
import type { GoogleCallContext } from './google.js';
import { createUpstreamClient, type UpstreamClient, type UpstreamFetch } from './request.js';
import type { Sleep } from './retry.js';
import { parseScope, type ParsedScope } from './scope.js';

export const CALLER_TOKEN = 'ya29.caller-token-for-tests';
export const ACCOUNT_TOKEN = 'ya29.account-token-for-tests';
export const CALLER_EMAIL = 'person@example.com';
export const ACCOUNT_EMAIL = 'gcportrait-backend@demo-host.iam.gserviceaccount.com';

/** One request the backend sent to the pretend Google. */
export interface RecordedCall {
  readonly url: URL;
  readonly method: string;
  readonly headers: Headers;
  /** The bearer token sent, if any. */
  readonly token: string | null;
  /** The body as sent, when it was text. */
  readonly body: string | undefined;
  readonly signal: AbortSignal | null;
  readonly redirect: RequestInit['redirect'];
}

/** Records a call of an `UpstreamFetch` in `calls` and returns it. */
export function recordCall(calls: RecordedCall[], url: string, init: RequestInit): RecordedCall {
  const headers = new Headers(init.headers);
  const authorization = headers.get('authorization');
  const call: RecordedCall = {
    url: new URL(url),
    method: init.method ?? 'GET',
    headers,
    token: authorization?.startsWith('Bearer ') === true ? authorization.slice('Bearer '.length) : null,
    body: typeof init.body === 'string' ? init.body : undefined,
    signal: init.signal ?? null,
    redirect: init.redirect,
  };
  calls.push(call);
  return call;
}

/** A call's JSON body, parsed (`{}` for a call without one). */
export function bodyOf(call: RecordedCall): unknown {
  return JSON.parse(call.body ?? '{}') as unknown;
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=UTF-8', ...headers },
  });
}

/** One `google.rpc.ErrorInfo` of an error answer. */
export interface ErrorInfoShape {
  readonly reason: string;
  readonly domain?: string;
  readonly metadata?: Readonly<Record<string, string>>;
}

/**
 * Google's error envelope with any number of ErrorInfo entries; a lone reason stands for one from
 * googleapis.com about the Cloud Asset API.
 */
export function googleError(
  status: number,
  code: string,
  message: string,
  details: string | readonly ErrorInfoShape[] = [],
): Response {
  const infos: readonly ErrorInfoShape[] =
    typeof details === 'string'
      ? [{ reason: details, domain: 'googleapis.com', metadata: { service: 'cloudasset.googleapis.com' } }]
      : details;
  return jsonResponse(status, {
    error: {
      code: status,
      message,
      status: code,
      ...(infos.length === 0
        ? {}
        : {
            details: infos.map((info) => ({
              '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
              reason: info.reason,
              ...(info.domain === undefined ? {} : { domain: info.domain }),
              metadata: info.metadata ?? {},
            })),
          }),
    },
  });
}

/** Google's HTML error page: what a request without the method override gets. */
export function htmlResponse(status = 404): Response {
  return new Response(`<!DOCTYPE html><html><body>Error ${String(status)}</body></html>`, {
    status,
    headers: { 'content-type': 'text/html; charset=UTF-8' },
  });
}

/** A body that arrives in `size`-byte chunks, so readers see a stream rather than one buffer. */
export function chunkedBody(bytes: Uint8Array, size = 64 * 1024): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

/** Waits until the request's signal aborts, then rejects as `fetch` does. */
export function untilAborted(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal === null || signal === undefined) return;
    if (signal.aborted) {
      reject(signal.reason as Error);
      return;
    }
    signal.addEventListener(
      'abort',
      () => {
        reject(signal.reason as Error);
      },
      { once: true },
    );
  });
}

/** A `sleep` that returns at once, so retries happen without waiting. */
export const immediateSleep: Sleep = (_ms, signal) =>
  signal.aborted ? Promise.reject(signal.reason as Error) : Promise.resolve();

/** A `sleep` that records each delay and returns at once. */
export function recordingSleep(): { readonly sleep: Sleep; readonly delays: number[] } {
  const delays: number[] = [];
  return {
    delays,
    sleep: (ms, signal) => {
      delays.push(ms);
      return immediateSleep(ms, signal);
    },
  };
}

/** A client over a pretend Google that never sleeps (retries happen at once) and has no jitter. */
export function testClient(fetch: UpstreamFetch): UpstreamClient {
  return createUpstreamClient({ fetch, sleep: immediateSleep, random: () => 0 });
}

/** The context of the calls of one pretend request. */
export function testContext(
  fetch: UpstreamFetch,
  signal: AbortSignal = new AbortController().signal,
): GoogleCallContext {
  return { client: testClient(fetch), signal, requestId: 'test-request-1', log: pino({ level: 'silent' }) };
}

/**
 * Cloud Asset Inventory's `assets.list` over `pages`: the page token `page-N` asks for page N, every page but the
 * last names the next, and a token past the end is Google's 400. Requests without the method override get Google's
 * HTML 404.
 */
export function caiPager(
  pages: readonly (readonly unknown[])[],
  readTime: string,
): (call: RecordedCall) => Response {
  return (call) => {
    if (call.method !== 'POST' || call.headers.get('x-http-method-override') !== 'GET')
      return htmlResponse(404);
    const { pageToken } = bodyOf(call) as { pageToken?: string };
    const index = pageToken === undefined ? 0 : Number(pageToken.replace('page-', ''));
    const page = pages[index];
    if (page === undefined)
      return googleError(400, 'INVALID_ARGUMENT', 'Request contains an invalid argument.');
    return jsonResponse(200, {
      ...(page.length === 0 ? {} : { assets: page }),
      ...(index + 1 < pages.length ? { nextPageToken: `page-${String(index + 1)}` } : {}),
      readTime,
    });
  };
}

/** The instance's service account as Application Default Credentials would resolve it; its token a mock. */
export type FakeAccount = ServiceAccountIdentity & {
  readonly accessToken: Mock<(signal: AbortSignal) => Promise<string>>;
};

export function fakeAccount(
  accessToken: (signal: AbortSignal) => Promise<string> = () => Promise.resolve(ACCOUNT_TOKEN),
): FakeAccount {
  return { email: ACCOUNT_EMAIL, source: 'metadata-server', accessToken: vi.fn(accessToken) };
}

/** A scope the test knows to be valid, parsed. */
export function scopeOf(text: string): ParsedScope {
  const parsed = parseScope(text);
  if (parsed === null) throw new Error(`bad test scope ${text}`);
  return parsed;
}
