// SPDX-License-Identifier: MIT
/**
 * The process-wide page budget (page-budget.ts): a claim grows with a page's bytes, is refused beyond the
 * budget without waiting, and is given back once the response has written the page's frame out (ndjson.ts asks
 * for the next line only then), when the page ends the stream with an error frame, when the stream ends or when
 * the client goes away or stalls; a pull whose pages the budget cannot hold ends with a retryable INSTANCE_BUSY
 * frame. Every page is synthetic (google.testing.ts).
 */
import { request, type IncomingMessage, type ServerResponse } from 'node:http';
import { Writable } from 'node:stream';

import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import { listenOnLoopback, startTestServer } from '../server.testing.js';
import { jsonResponse, recordingSleep, untilAborted } from '../upstream/google.testing.js';
import { createUpstreamClient } from '../upstream/request.js';
import { assetListFrames, type AssetListStats } from './asset-list.js';
import { linesOf, mockCai, syntheticAsset, syntheticPages, type Override } from './google.testing.js';
import { WRITE_PIECE_BYTES } from './ndjson.js';
import { DEFAULT_PAGE_BUDGET_BYTES, PageBudget } from './page-budget.js';

const TOKEN = 'ya29.page-budget-test-token';
const BODY = {
  scope: 'projects/demo-app-1',
  contentType: 'RESOURCE',
  mode: 'user',
  quotaProject: 'demo-quota-1',
} as const;

/** The size of a page of `assets` as mockCai answers it. */
function bytesOf(assets: readonly unknown[]): number {
  return Buffer.byteLength(JSON.stringify({ assets, readTime: 'x' }));
}

/** The size of one synthetic page of `count` assets as mockCai answers it. */
function pageBytes(count: number): number {
  return bytesOf(syntheticPages(count, count)[0] ?? []);
}

/** Pages far larger than the kernel's socket buffers on the loopback (a few MiB), so a frame must wait. */
const LARGE = 14_000;

/** One page of {@link LARGE} assets (about 15.6 MiB as Google sends it) and its size: built once, read by every test. */
const large = (() => {
  let built: { readonly page: readonly unknown[]; readonly bytes: number } | undefined;
  return () => {
    if (built === undefined) {
      const page = syntheticPages(LARGE, LARGE)[0] ?? [];
      built = { page, bytes: bytesOf(page) };
    }
    return built;
  };
})();

describe('PageBudget', () => {
  it('lets claims grow up to the budget and refuses what would go over, adding nothing', () => {
    const budget = new PageBudget(100);
    const first = budget.claim();
    const second = budget.claim();
    expect(first.take(60)).toBe(true);
    expect(second.take(50)).toBe(false);
    expect(budget.used).toBe(60);
    expect(second.take(40)).toBe(true);
    expect(budget.used).toBe(100);
    first.release();
    expect(budget.used).toBe(40);
    second.release();
    expect(budget.used).toBe(0);
  });

  it('gives a claim back once, however often it is released, and refuses a released claim', () => {
    const budget = new PageBudget(100);
    const claim = budget.claim();
    expect(claim.take(30)).toBe(true);
    claim.release();
    claim.release();
    expect(budget.used).toBe(0);
    expect(claim.take(1)).toBe(false);
    expect(budget.used).toBe(0);
  });

  it('defaults to 64 MiB: two pages at the 25 MiB cap and room for small ones', () => {
    expect(DEFAULT_PAGE_BUDGET_BYTES).toBe(64 * 1024 * 1024);
    expect(new PageBudget().limit).toBe(DEFAULT_PAGE_BUDGET_BYTES);
  });
});

/** A line of the stream as text, whether the generator wrote it as a string or a buffer. */
function text(line: string | Uint8Array): string {
  return typeof line === 'string' ? line : new TextDecoder().decode(line);
}

/** The generator's next line as text ('' once it is done). */
async function nextText(generator: AsyncGenerator<string | Uint8Array, void>): Promise<string> {
  const result = await generator.next();
  return result.done === true ? '' : text(result.value);
}

describe('assetListFrames with a budget', () => {
  function frames(budget: PageBudget, pages: readonly (readonly unknown[])[], override?: Override) {
    const { sleep } = recordingSleep();
    const stats: AssetListStats = { pages: 0, assets: 0, retries: 0 };
    const cai = mockCai(pages, override === undefined ? {} : { override });
    const generator = assetListFrames(
      { scopePath: 'projects/demo-app-1' },
      {
        client: createUpstreamClient({ fetch: cai.fetch, sleep, random: () => 0 }),
        credentials: () => Promise.resolve({ ok: true, token: TOKEN, quotaProject: 'demo-quota-1' }),
        stats,
        budget,
      },
      new AbortController().signal,
    );
    return { generator, stats };
  }

  // The generator alone: the response asks it for the next line only once it has written the frame out (ndjson.ts;
  // over HTTP below, with a client that does not read).
  it('holds a page while its frame waits, and gives it back when it is asked for the next line', async () => {
    const budget = new PageBudget(10 * 1024 * 1024);
    const { generator } = frames(budget, syntheticPages(1000));
    expect(await nextText(generator)).toContain('"t":"progress"');
    expect(budget.used).toBe(0);
    expect(await nextText(generator)).toContain('"t":"page"');
    // The frame is out of the generator's hands only once the next line is asked for: the page's bytes stay
    // claimed (a 500-asset page of about 1.2 kB each, as Google sent it) until then.
    expect(budget.used).toBeGreaterThan(pageBytes(500));
    expect(budget.used).toBeLessThan(pageBytes(500) + 100);
    expect(await nextText(generator)).toContain('"pages":1');
    expect(budget.used).toBe(0);
    let rest = 0;
    for await (const line of generator) if (text(line).includes('"t":"page"')) rest += 1;
    expect(rest).toBe(1);
    expect(budget.used).toBe(0);
  });

  it('gives the claim back when the stream is closed while a frame waits', async () => {
    const budget = new PageBudget(10 * 1024 * 1024);
    const { generator } = frames(budget, syntheticPages(1000));
    await generator.next();
    await generator.next();
    expect(budget.used).toBeGreaterThan(0);
    await generator.return(undefined);
    expect(budget.used).toBe(0);
  });

  /** A whole pull's lines as text, and the budget once it ended. */
  async function pull(override: Override): Promise<{ readonly last: unknown; readonly used: number }> {
    const budget = new PageBudget(10 * 1024 * 1024);
    const { generator } = frames(budget, syntheticPages(10), override);
    const lines: string[] = [];
    for await (const line of generator) lines.push(text(line));
    return { last: linesOf(lines.join('')).at(-1), used: budget.used };
  }

  // An answer that is not a page must not keep its claim for the life of the process.
  it('gives the claim back when a 200 answer is not a page of assets', async () => {
    const html = new Response(`<html>${'x'.repeat(1024 * 1024)}</html>`, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
    const array = jsonResponse(
      200,
      Array.from({ length: 300_000 }, () => 1),
    );
    for (const answer of [html, array]) {
      const { last, used } = await pull(() => answer);
      expect(last).toMatchObject({ t: 'error', status: 502, code: 'BAD_UPSTREAM_ANSWER' });
      expect(used).toBe(0);
    }
  });

  it('gives the claim back when Google answers with a 2xx other than 200', async () => {
    const { last, used } = await pull(() =>
      jsonResponse(203, { assets: [{ name: 'x'.repeat(1024 * 1024) }], readTime: 'x' }),
    );
    expect(last).toMatchObject({ t: 'error', status: 203 });
    expect(used).toBe(0);
  });

  it('ends a pull whose page the budget cannot hold with a retryable INSTANCE_BUSY frame, after the retries', async () => {
    const budget = new PageBudget(1024);
    const { generator, stats } = frames(budget, syntheticPages(10));
    const lines: string[] = [];
    for await (const line of generator) lines.push(text(line));
    const last = linesOf(lines.join('')).at(-1);
    expect(last).toEqual({
      t: 'error',
      message:
        'This gcportrait instance is reading too many large answers at once, so it could not read a page of ' +
        'Cloud Asset Inventory results (5 attempts). Try again in a minute.',
      status: 503,
      code: 'INSTANCE_BUSY',
      retryable: true,
    });
    expect(stats.retries).toBe(4);
    expect(budget.used).toBe(0);
  });
});

describe('the page budget across streams, over HTTP', () => {
  async function serve(
    budget: PageBudget,
    options?: Parameters<typeof mockCai>[1],
    more: { readonly pages?: readonly (readonly unknown[])[]; readonly streamStallMs?: number } = {},
  ) {
    const cai = mockCai(more.pages ?? syntheticPages(1000), options);
    const { app, logs } = await startTestServer({
      logLevel: 'info',
      fetch: cai.fetch,
      pageBudget: budget,
      ...(more.streamStallMs === undefined ? {} : { streamStallMs: more.streamStallMs }),
    });
    return { app, cai, logs: logs.text };
  }

  /** Starts a live pull over a real connection and resolves with its response, which nothing reads yet. */
  async function startPull(app: FastifyInstance) {
    const port = await listenOnLoopback(app);
    const client = request(`http://127.0.0.1:${String(port)}/api/assets/stream`, {
      method: 'POST',
      agent: false,
      headers: { 'content-type': 'application/json', 'x-gcportrait-token': TOKEN },
    });
    client.on('error', () => undefined);
    const response = await new Promise<IncomingMessage>((resolve) => {
      client.on('response', resolve);
      client.end(JSON.stringify(BODY));
    });
    response.on('error', () => undefined);
    return { client, response };
  }

  /**
   * Reads `response` steadily at about `bytesPerSecond`: it takes a chunk (a socket hands over at most 64 KiB
   * at a time), and the next one only after the time that chunk takes at that rate. Records each one's time.
   */
  function readSteadily(response: IncomingMessage, bytesPerSecond: number) {
    const taken: number[] = [];
    const chunks: Buffer[] = [];
    const ended = new Promise<void>((resolve) => {
      response.on('end', resolve);
    });
    response.pipe(
      new Writable({
        highWaterMark: 1,
        write(chunk: Buffer, _encoding, callback) {
          taken.push(performance.now());
          chunks.push(chunk);
          setTimeout(callback, (chunk.byteLength / bytesPerSecond) * 1000);
        },
      }),
    );
    return {
      taken,
      ended,
      received: () => chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
      body: () => Buffer.concat(chunks).toString('utf8'),
    };
  }

  it('leaves nothing claimed after concurrent pulls by different callers', async () => {
    const budget = new PageBudget(3 * pageBytes(500));
    const { app } = await serve(budget);
    const answers = await Promise.all(
      ['a', 'b', 'c', 'd'].map((who) =>
        app.inject({
          method: 'POST',
          url: '/api/assets/stream',
          headers: { 'x-gcportrait-token': `${TOKEN}-${who}` },
          payload: BODY,
        }),
      ),
    );
    for (const answer of answers) {
      const last = linesOf(answer.body).at(-1) as Record<string, unknown>;
      // Either the whole pull, or (when four pages met at once) the busy frame; never anything else.
      expect(['done', 'error']).toContain(last.t);
      if (last.t === 'error') expect(last.code).toBe('INSTANCE_BUSY');
    }
    expect(answers.some((answer) => (linesOf(answer.body).at(-1) as { t: string }).t === 'done')).toBe(true);
    expect(budget.used).toBe(0);
  });

  it('gives a page back when its client goes away before reading it', async () => {
    const budget = new PageBudget(10 * 1024 * 1024);
    // The second page never comes: the stream waits on Google after handing on the first.
    const { app } = await serve(budget, {
      override: (call, index) => (index === 0 ? undefined : untilAborted(call.signal)),
    });
    const port = await listenOnLoopback(app);
    const client = request(`http://127.0.0.1:${String(port)}/api/assets/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-gcportrait-token': TOKEN },
    });
    client.on('error', () => undefined);
    await new Promise<void>((resolve) => {
      client.on('response', (response) => {
        response.on('data', (chunk: Buffer) => {
          if (chunk.toString('utf8').includes('"t":"page"')) resolve();
        });
        response.on('error', () => undefined);
      });
      client.end(JSON.stringify(BODY));
    });
    client.destroy();
    await expect.poll(() => budget.used).toBe(0);
  });

  // Readable.from asks for the next line once a frame is queued on the socket, so a client that stops reading
  // would keep a whole page in memory that the budget no longer counts.
  it('keeps a page claimed while its client does not read it, and asks Google for nothing more meanwhile', async () => {
    const budget = new PageBudget();
    // The second page only has to exist: one asset, so the client reads one large page, not two.
    const { app, cai, logs } = await serve(budget, undefined, {
      pages: [large().page, [syntheticAsset(LARGE)]],
    });
    const responses: ServerResponse[] = [];
    app.server.on('request', (_request, raw: ServerResponse) => {
      responses.push(raw);
    });
    const { client, response } = await startPull(app);
    const claimed = large().bytes;
    await expect.poll(() => budget.used, { timeout: 10_000 }).toBeGreaterThanOrEqual(claimed);
    // The frame waits on the full socket and keeps its claim, so the second page is not asked for while it
    // waits; that it never happens can only be watched for a while.
    await expect.poll(() => responses[0]?.writableNeedDrain, { timeout: 10_000 }).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(cai.calls).toHaveLength(1);
    expect(budget.used).toBeGreaterThanOrEqual(claimed);
    expect(logs()).not.toContain('asset stream ended');

    // The client reads on: everything arrives, whole, and nothing stays claimed.
    response.setEncoding('utf8');
    const body = await new Promise<string>((resolve) => {
      let received = '';
      response.on('data', (chunk: string) => {
        received += chunk;
      });
      response.on('end', () => {
        resolve(received);
      });
    });
    client.destroy();
    const frames = linesOf(body) as { t: string; assets?: unknown }[];
    expect(
      frames.filter((frame) => frame.t === 'page').map((frame) => (frame.assets as unknown[]).length),
    ).toEqual([LARGE, 1]);
    expect(frames.at(-1)).toMatchObject({ t: 'done', assets: LARGE + 1 });
    expect(cai.calls).toHaveLength(2);
    await expect.poll(() => budget.used).toBe(0);
    expect(logs()).toContain('"outcome":"finished"');
  }, 30_000);

  it('closes the connection of a client that takes nothing for the stall limit, and gives its page back', async () => {
    const budget = new PageBudget();
    const { app, logs } = await serve(budget, undefined, {
      pages: [large().page],
      streamStallMs: 300,
    });
    const { client } = await startPull(app);
    await expect.poll(() => budget.used, { timeout: 10_000 }).toBeGreaterThanOrEqual(large().bytes);
    await expect.poll(() => logs(), { timeout: 10_000 }).toContain('"outcome":"client-stalled"');
    expect(budget.used).toBe(0);
    const open = await new Promise<number>((resolve) => {
      app.server.getConnections((_error, count) => {
        resolve(count);
      });
    });
    expect(open).toBe(0);
    client.destroy();
  }, 30_000);

  // The stall limit is a minimum rate, not only a cut for a client that stops. Each
  // piece that has to wait (a frame, or 1 MiB of a larger one) must be taken whole within the limit.
  it('cuts off a client that keeps reading, but slower than a piece per stall limit', async () => {
    const stallMs = 1000;
    const budget = new PageBudget();
    const { app, logs } = await serve(budget, undefined, {
      pages: [large().page],
      streamStallMs: stallMs,
    });
    const { client, response } = await startPull(app);
    // Half a piece per stall limit: a piece takes two limits to be taken, so the reader is too slow however late it
    // runs, while a 64 KiB chunk comes about every 125 ms, an eighth of the limit, so that a busy machine's pauses do
    // not open a gap of the limit between two chunks.
    const reader = readSteadily(response, WRITE_PIECE_BYTES / 2 / (stallMs / 1000));
    await expect
      .poll(() => logs(), { timeout: 20_000, interval: 10 })
      .toContain('"outcome":"client-stalled"');
    const cut = performance.now();
    // It never stopped: no gap between two chunks, or between the last one and the cut, reached the limit.
    const before = reader.taken.filter((at) => at <= cut);
    const gaps = before.map((at, index) => (before[index + 1] ?? cut) - at);
    expect(before.length).toBeGreaterThan(1);
    expect(Math.max(...gaps)).toBeLessThan(stallMs);
    expect(reader.received()).toBeLessThan(large().bytes);
    await expect.poll(() => budget.used).toBe(0);
    client.destroy();
  }, 30_000);

  it('lets a client that takes more than a piece per stall limit read for as long as it needs', async () => {
    const stallMs = 1000;
    const budget = new PageBudget();
    const { app, logs } = await serve(budget, undefined, {
      pages: [large().page],
      streamStallMs: stallMs,
    });
    const { client, response } = await startPull(app);
    const started = performance.now();
    // Eight pieces per stall limit: the page (about 15.6 MiB) takes about two stall limits to arrive.
    const reader = readSteadily(response, (8 * WRITE_PIECE_BYTES) / (stallMs / 1000));
    await reader.ended;
    expect(performance.now() - started).toBeGreaterThan(stallMs);
    const frames = linesOf(reader.body()) as { t: string; assets?: unknown }[];
    expect(
      frames.filter((frame) => frame.t === 'page').map((frame) => (frame.assets as unknown[]).length),
    ).toEqual([LARGE]);
    expect(frames.at(-1)).toMatchObject({ t: 'done', assets: LARGE });
    await expect.poll(() => logs()).toContain('"outcome":"finished"');
    await expect.poll(() => budget.used).toBe(0);
    client.destroy();
  }, 30_000);
});
