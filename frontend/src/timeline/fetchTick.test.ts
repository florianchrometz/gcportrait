// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Reading a live day into the tick cache (fetchTick.ts) through the live pull, with the in-process import worker and
 * a pretend backend: the request names the scope, the day's read time (none for the latest day, "now"), the mode
 * and the quota project; the day is stored under its cache key with what Google reported, not as a snapshot;
 * progress arrives as the pull's; a failure carries Google's message verbatim; a cancel stores nothing, one that
 * lands as the day's write begins or while the day is written included, and the read ends as cancelled, not done.
 */
import { generateOrganization, toCaiAsset } from '@gcportrait/demo-data';
import { migrateSnapshot } from '@gcportrait/model';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NO_AUTH, type AuthControls } from '../auth';
import { inProcessImportWorker } from '../import/worker/inProcess';
import type { ImportProgress } from '../import/progress';
import { decodeJson } from '../snapshots/codec';
import { TickWriteCancelled, type StoredTick, type TickCacheStore } from '../storage/tickCache';
import { liveTickKey } from './controller';
import { createTickFetcher, TickReadFailed, type TickJob } from './fetchTick';

const ASSETS = generateOrganization({ size: 'S' }).assets.map(toCaiAsset);
const SCOPE = { kind: 'organization' as const, id: '30000000001', displayName: 'example.com' };
const INFO = {
  kind: 'live' as const,
  scope: SCOPE,
  scopePath: 'organizations/30000000001',
  readTime: '2026-10-07T09:12:00Z',
};

function frames(readTime: string, end: 'done' | Record<string, unknown> = 'done'): string {
  const lines = [
    JSON.stringify({ t: 'progress', pages: 0, assets: 0 }),
    JSON.stringify({ t: 'page', assets: ASSETS }),
    JSON.stringify({ t: 'progress', pages: 1, assets: ASSETS.length }),
    end === 'done'
      ? JSON.stringify({ t: 'done', assets: ASSETS.length, readTime })
      : JSON.stringify({ t: 'error', ...end }),
  ];
  return `${lines.join('\n')}\n`;
}

function backend(text: string): { readonly bodies: unknown[] } {
  const bodies: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_path: string, init: RequestInit) => {
      bodies.push(typeof init.body === 'string' ? JSON.parse(init.body) : null);
      if (init.signal?.aborted === true) return Promise.reject(new DOMException('aborted', 'AbortError'));
      return Promise.resolve(new Response(text, { headers: { 'content-type': 'application/x-ndjson' } }));
    }),
  );
  return { bodies };
}

const auth: AuthControls = { ...NO_AUTH, accessToken: () => 'ya29.synthetic-test-token' };

function memoryCache(): TickCacheStore & {
  readonly stored: Map<string, StoredTick>;
  readonly todays: string[];
} {
  const stored = new Map<string, StoredTick>();
  const todays: string[] = [];
  return {
    stored,
    todays,
    get: (key) => Promise.resolve(stored.get(key)),
    // As the real store: nothing is written once the signal is aborted, and a tick whose abort lands while it is
    // written (the write takes a moment) is taken back, what it replaced put back.
    put: async (tick, today, options) => {
      const aborted = (): boolean => options?.signal?.aborted === true;
      if (aborted()) throw new TickWriteCancelled();
      const replaced = stored.get(tick.key);
      stored.set(tick.key, tick);
      todays.push(today);
      await Promise.resolve();
      if (aborted()) {
        if (replaced === undefined) stored.delete(tick.key);
        else stored.set(tick.key, replaced);
        throw new TickWriteCancelled();
      }
    },
    listScope: () => Promise.resolve([...stored.values()]),
  };
}

function job(day: string, readTime: string | null): TickJob {
  return {
    key: liveTickKey(INFO, day),
    day,
    readTime,
    scopePath: INFO.scopePath,
    scope: SCOPE,
    target: { mode: 'user', quotaProject: 'demo-quota-1' },
    today: '2026-10-10',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reading a live day', () => {
  it('asks for the day’s read time and stores the day under its cache key', async () => {
    const { bodies } = backend(frames('2026-10-01T00:00:00Z'));
    const cache = memoryCache();
    const worker = inProcessImportWorker()();
    const read = createTickFetcher({
      auth,
      cache,
      worker: () => Promise.resolve(worker.client),
      clock: () => Date.parse('2026-10-10T12:00:00Z'),
    });
    const progress: ImportProgress[] = [];
    await read(job('2026-10-01', '2026-10-01T00:00:00Z'), new AbortController().signal, (next) =>
      progress.push(next),
    );
    expect(bodies).toEqual([
      {
        scope: 'organizations/30000000001',
        contentType: 'RESOURCE',
        mode: 'user',
        quotaProject: 'demo-quota-1',
        readTime: '2026-10-01T00:00:00Z',
      },
    ]);
    const stored = cache.stored.get(liveTickKey(INFO, '2026-10-01'));
    expect(stored).toMatchObject({
      scope: 'organizations/30000000001',
      readTime: '2026-10-01T00:00:00Z',
      day: '2026-10-01',
      contentType: 'RESOURCE',
      now: false,
      actualReadTime: '2026-10-01T00:00:00Z',
      fetchedAt: '2026-10-10T12:00:00.000Z',
      assetCount: ASSETS.length,
    });
    expect(stored?.bytes).toBe(stored?.blob.size);
    expect(cache.todays).toEqual(['2026-10-10']);
    const snapshot = migrateSnapshot(stored === undefined ? null : await decodeJson(stored.blob));
    expect(snapshot.readTime).toBe('2026-10-01T00:00:00Z');
    expect(snapshot.scope).toEqual(SCOPE);
    expect(progress.at(-1)).toMatchObject({ phase: 'done', pages: 1, assets: ASSETS.length });
    expect(progress.some((step) => step.bytes > 0)).toBe(true);
  });

  it('reads the latest day at "now": no read time asked, the record marked', async () => {
    const { bodies } = backend(frames('2026-10-10T11:59:58.123456Z'));
    const cache = memoryCache();
    const worker = inProcessImportWorker()();
    const read = createTickFetcher({ auth, cache, worker: () => Promise.resolve(worker.client) });
    await read(job('2026-10-10', null), new AbortController().signal, () => undefined);
    expect(bodies[0]).not.toHaveProperty('readTime');
    expect(cache.stored.get(liveTickKey(INFO, '2026-10-10'))).toMatchObject({
      readTime: '2026-10-10T00:00:00Z',
      now: true,
      actualReadTime: '2026-10-10T11:59:58.123456Z',
    });
  });

  it('fails with Google’s message verbatim and stores nothing', async () => {
    backend(
      frames('', {
        message: 'The caller does not have permission',
        status: 403,
        code: 'PERMISSION_DENIED',
        retryable: false,
      }),
    );
    const cache = memoryCache();
    const worker = inProcessImportWorker()();
    const read = createTickFetcher({ auth, cache, worker: () => Promise.resolve(worker.client) });
    const failed = read(
      job('2026-10-01', '2026-10-01T00:00:00Z'),
      new AbortController().signal,
      () => undefined,
    );
    await expect(failed).rejects.toBeInstanceOf(TickReadFailed);
    await failed.catch((error: unknown) => {
      expect(error instanceof TickReadFailed ? error.failure.message : '').toBe(
        'The caller does not have permission',
      );
    });
    expect(cache.stored.size).toBe(0);
  });

  it('stores nothing when cancelled', async () => {
    backend(frames('2026-10-01T00:00:00Z'));
    const cache = memoryCache();
    const worker = inProcessImportWorker()();
    const read = createTickFetcher({ auth, cache, worker: () => Promise.resolve(worker.client) });
    const controller = new AbortController();
    controller.abort();
    await expect(
      read(job('2026-10-01', '2026-10-01T00:00:00Z'), controller.signal, () => undefined),
    ).rejects.toThrow('cancelled');
    expect(cache.stored.size).toBe(0);
  });

  /**
   * The cache with the read cancelled as the day's write begins (`before` the cache is called) or while the day is
   * written (`during`); `signals` are the signals the writes were given.
   */
  function cancelling(
    cache: TickCacheStore,
    controller: AbortController,
    when: 'before' | 'during',
  ): TickCacheStore & { readonly signals: (AbortSignal | undefined)[] } {
    const signals: (AbortSignal | undefined)[] = [];
    return {
      ...cache,
      signals,
      put(tick, today, options) {
        signals.push(options?.signal);
        if (when === 'before') controller.abort();
        const writing = cache.put(tick, today, options);
        controller.abort();
        return writing;
      },
    };
  }

  it.each(['before', 'during'] as const)(
    'keeps nothing of a day cancelled %s its write, and ends the read as cancelled',
    async (when) => {
      backend(frames('2026-10-01T00:00:00Z'));
      const cache = memoryCache();
      const controller = new AbortController();
      const writes = cancelling(cache, controller, when);
      const worker = inProcessImportWorker()();
      const read = createTickFetcher({ auth, cache: writes, worker: () => Promise.resolve(worker.client) });
      const progress: ImportProgress[] = [];
      await expect(
        read(job('2026-10-01', '2026-10-01T00:00:00Z'), controller.signal, (next) => progress.push(next)),
      ).rejects.toThrow('cancelled');
      // The write was given the read's signal, and the cancel reached it.
      expect(writes.signals).toHaveLength(1);
      expect(writes.signals[0]?.aborted).toBe(true);
      expect(cache.stored.size).toBe(0);
      expect(progress.at(-1)).toMatchObject({ phase: 'cancelled', result: null, failure: null });
      expect(progress.some((step) => step.phase === 'done')).toBe(false);
    },
  );
});
