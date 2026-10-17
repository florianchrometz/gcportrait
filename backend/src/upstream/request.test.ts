// SPDX-License-Identifier: MIT
import { afterEach, describe, expect, it, vi } from 'vitest';

import { chunkedBody, googleError, jsonResponse, recordingSleep, untilAborted } from './google.testing.js';
import {
  UpstreamExchangeError,
  createUpstreamClient,
  openStream,
  requestJson,
  type UpstreamFetch,
  type UpstreamRequest,
} from './request.js';

const LIST: UpstreamRequest = {
  url: 'https://cloudasset.googleapis.com/v1/projects/demo-app-1/assets',
  method: 'POST',
  headers: { authorization: 'Bearer test-token' },
  body: '{}',
};

const never = new AbortController().signal;

function scripted(answers: readonly (() => Response | Promise<Response>)[]): {
  fetch: UpstreamFetch;
  calls: () => number;
} {
  let calls = 0;
  return {
    fetch: () => {
      const answer = answers[Math.min(calls, answers.length - 1)];
      calls += 1;
      if (answer === undefined) throw new Error('no answer scripted');
      return Promise.resolve(answer());
    },
    calls: () => calls,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('requestJson retries', () => {
  it('retries 429 and 5xx with growing jittered delays, then returns the answer', async () => {
    const { sleep, delays } = recordingSleep();
    const { fetch, calls } = scripted([
      () => googleError(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded.'),
      () => googleError(503, 'UNAVAILABLE', 'Try again.'),
      () => googleError(500, 'INTERNAL', 'Oops.'),
      () => jsonResponse(200, { readTime: '2026-10-08T12:00:00Z' }),
    ]);
    const retries: unknown[] = [];
    const client = createUpstreamClient({ fetch, sleep, random: () => 0.5 });
    const answer = await requestJson(client, LIST, {
      signal: never,
      maxBytes: 1024,
      onRetry: (event) => retries.push(event),
    });
    expect(answer.status).toBe(200);
    expect(answer.attempts).toBe(4);
    expect(calls()).toBe(4);
    expect(delays).toEqual([375, 750, 1500]);
    expect(retries).toEqual([
      { attempt: 1, delayMs: 375, status: 429 },
      { attempt: 2, delayMs: 750, status: 503 },
      { attempt: 3, delayMs: 1500, status: 500 },
    ]);
  });

  it('gives up after 5 attempts and returns the last transient answer', async () => {
    const { sleep, delays } = recordingSleep();
    const { fetch, calls } = scripted([() => googleError(503, 'UNAVAILABLE', 'Still busy.')]);
    const client = createUpstreamClient({ fetch, sleep, random: () => 0 });
    const answer = await requestJson(client, LIST, { signal: never, maxBytes: 1024 });
    expect(answer.status).toBe(503);
    expect(answer.attempts).toBe(5);
    expect(calls()).toBe(5);
    expect(delays).toEqual([250, 500, 1000, 2000]);
  });

  it('does not retry 400, 401, 403 or 404', async () => {
    for (const status of [400, 401, 403, 404]) {
      const { sleep, delays } = recordingSleep();
      const { fetch, calls } = scripted([() => googleError(status, 'X', 'no')]);
      const answer = await requestJson(createUpstreamClient({ fetch, sleep }), LIST, {
        signal: never,
        maxBytes: 1024,
      });
      expect(answer.status).toBe(status);
      expect(calls()).toBe(1);
      expect(delays).toEqual([]);
    }
  });

  it('waits the real backoff on the timer (fake timers)', async () => {
    vi.useFakeTimers();
    const { fetch, calls } = scripted([
      () => googleError(503, 'UNAVAILABLE', 'busy'),
      () => googleError(503, 'UNAVAILABLE', 'busy'),
      () => jsonResponse(200, {}),
    ]);
    const client = createUpstreamClient({ fetch, random: () => 0 });
    const pending = requestJson(client, LIST, { signal: never, maxBytes: 1024 });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(499);
    expect(calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(200);
    expect(calls()).toBe(3);
  });

  it('times an attempt out after 60 s, retries it, and reports the timeout after the last one', async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fetch: UpstreamFetch = (_url, init) => {
      calls += 1;
      return untilAborted(init.signal);
    };
    const client = createUpstreamClient({ fetch, random: () => 0 });
    const pending = requestJson(client, LIST, { signal: never, maxBytes: 1024 });
    const outcome = pending.then(
      () => null,
      (error: unknown) => error,
    );
    // 5 attempts of 60 s, and backoffs of 250 + 500 + 1000 + 2000 ms between them.
    await vi.advanceTimersByTimeAsync(5 * 60_000 + 3750);
    const error = await outcome;
    expect(error).toBeInstanceOf(UpstreamExchangeError);
    expect(error).toMatchObject({ kind: 'timeout', attempts: 5 });
    expect(calls).toBe(5);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retries a transport failure', async () => {
    const { sleep } = recordingSleep();
    const { fetch, calls } = scripted([
      () => Promise.reject(new TypeError('fetch failed')),
      () => jsonResponse(200, { ok: true }),
    ]);
    const answer = await requestJson(createUpstreamClient({ fetch, sleep }), LIST, {
      signal: never,
      maxBytes: 1024,
    });
    expect(answer.status).toBe(200);
    expect(calls()).toBe(2);
  });

  it('takes a redirect as a final answer: never followed, never retried as a network failure', async () => {
    // Node's fetch rejects a redirect under `redirect: "error"` like a network failure ("fetch failed", caused by
    // "unexpected redirect"); under "manual" it hands the 3xx back. This stand-in behaves the same way.
    const calls: RequestInit[] = [];
    const fetch: UpstreamFetch = (_url, init) => {
      calls.push(init);
      if (init.redirect === 'error')
        return Promise.reject(new TypeError('fetch failed', { cause: new Error('unexpected redirect') }));
      return Promise.resolve(
        new Response('<a href="https://example.com/x">moved</a>', {
          status: 302,
          headers: { location: 'https://example.com/x' },
        }),
      );
    };
    const { sleep, delays } = recordingSleep();
    const answer = await requestJson(createUpstreamClient({ fetch, sleep }), LIST, {
      signal: never,
      maxBytes: 1024,
    });
    expect(answer).toMatchObject({ status: 302, attempts: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.redirect).toBe('manual');
    expect(delays).toEqual([]);

    const opened = await openStream(createUpstreamClient({ fetch, sleep }), LIST, {
      signal: never,
      maxBytes: 1024,
    });
    expect(opened).toMatchObject({ ok: false, answer: { status: 302, attempts: 1 } });
    expect(calls).toHaveLength(2);
  });

  it('stops at once, without a retry, when the client aborts during a backoff', async () => {
    vi.useFakeTimers();
    const { fetch, calls } = scripted([() => googleError(503, 'UNAVAILABLE', 'busy')]);
    const controller = new AbortController();
    const pending = requestJson(createUpstreamClient({ fetch }), LIST, {
      signal: controller.signal,
      maxBytes: 1024,
    });
    const outcome = pending.then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(10);
    const reason = new Error('client gone');
    controller.abort(reason);
    expect(await outcome).toBe(reason);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls()).toBe(1);
  });
});

describe('the byte cap', () => {
  it('keeps a single chunk without copying and accepts an absent body', async () => {
    const chunk = new Uint8Array([0x61, 0x62]);
    const { fetch } = scripted([
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(chunk);
              controller.close();
            },
          }),
        ),
      () => new Response(null, { status: 204 }),
    ]);
    const client = createUpstreamClient({ fetch });
    expect((await requestJson(client, LIST, { signal: never, maxBytes: 2 })).body).toBe(chunk);
    expect((await requestJson(client, LIST, { signal: never, maxBytes: 2 })).body.byteLength).toBe(0);
  });

  it('cancels before claiming an oversized chunk and releases the earlier claim', async () => {
    const cancel = vi.fn(() => Promise.reject(new Error('cancel failed')));
    const take = vi.fn(() => true);
    const release = vi.fn();
    const { fetch } = scripted([
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(2));
              controller.enqueue(new Uint8Array(2));
            },
            cancel,
          }),
        ),
    ]);
    await expect(
      requestJson(createUpstreamClient({ fetch }), LIST, {
        signal: never,
        maxBytes: 3,
        claim: () => ({ take, release }),
      }),
    ).rejects.toMatchObject({ kind: 'too-large', attempts: 1 });
    expect(take).toHaveBeenCalledExactlyOnceWith(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });

  it('refuses a declared body over the cap without reading it, and does not retry', async () => {
    const { fetch, calls } = scripted([
      () => new Response('x'.repeat(10), { status: 200, headers: { 'content-length': '2000' } }),
    ]);
    const error = await requestJson(createUpstreamClient({ fetch }), LIST, {
      signal: never,
      maxBytes: 1000,
    }).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'too-large', attempts: 1 });
    expect(calls()).toBe(1);
  });

  it('stops reading a streamed body once it passes the cap', async () => {
    const { fetch } = scripted([() => new Response(chunkedBody(new Uint8Array(5000), 100), { status: 200 })]);
    await expect(
      requestJson(createUpstreamClient({ fetch }), LIST, { signal: never, maxBytes: 1000 }),
    ).rejects.toMatchObject({ kind: 'too-large', message: "Google's answer is larger than 1000 bytes." });
  });

  it('reads a body just under the cap', async () => {
    const { fetch } = scripted([() => new Response(chunkedBody(new Uint8Array(1000), 100), { status: 200 })]);
    const answer = await requestJson(createUpstreamClient({ fetch }), LIST, {
      signal: never,
      maxBytes: 1000,
    });
    expect(answer.body.byteLength).toBe(1000);
  });
});

describe('openStream', () => {
  it('hands over a 2xx body unread and reads an error answer in full', async () => {
    const { fetch } = scripted([
      () => new Response(chunkedBody(new TextEncoder().encode('a\nb\n'), 2), { status: 200 }),
    ]);
    const opened = await openStream(
      createUpstreamClient({ fetch }),
      { ...LIST, method: 'GET' },
      {
        signal: never,
        maxBytes: 1024,
      },
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const chunks: string[] = [];
    for await (const chunk of opened.stream.body) chunks.push(new TextDecoder().decode(chunk));
    expect(chunks.join('')).toBe('a\nb\n');

    const failing = scripted([() => googleError(403, 'PERMISSION_DENIED', 'no access')]);
    const refused = await openStream(createUpstreamClient({ fetch: failing.fetch }), LIST, {
      signal: never,
      maxBytes: 1024,
    });
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.answer.status).toBe(403);
  });

  it('retries a transient status before the body is handed over', async () => {
    const { sleep, delays } = recordingSleep();
    const { fetch, calls } = scripted([
      () => googleError(503, 'UNAVAILABLE', 'busy'),
      () => new Response('line\n', { status: 200 }),
    ]);
    const opened = await openStream(createUpstreamClient({ fetch, sleep, random: () => 0 }), LIST, {
      signal: never,
      maxBytes: 1024,
    });
    expect(opened.ok).toBe(true);
    expect(calls()).toBe(2);
    expect(delays).toEqual([250]);
  });

  it('ends a stream that stays silent for 60 s with a timeout', async () => {
    vi.useFakeTimers();
    const fetch: UpstreamFetch = (_url, init) => {
      const { signal } = init;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('first\n'));
          signal?.addEventListener('abort', () => {
            controller.error(signal.reason);
          });
        },
      });
      return Promise.resolve(new Response(body, { status: 200 }));
    };
    const opened = await openStream(createUpstreamClient({ fetch }), LIST, { signal: never, maxBytes: 1024 });
    if (!opened.ok) throw new Error('expected a stream');
    const iterator = opened.stream.body[Symbol.asyncIterator]();
    expect((await iterator.next()).done).toBe(false);
    const next = iterator.next().then(
      () => null,
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await next).toMatchObject({ kind: 'timeout' });
  });
});
