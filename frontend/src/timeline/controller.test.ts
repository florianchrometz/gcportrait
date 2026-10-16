// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The timeline controller (controller.ts) on a real app store, with a fake cache, a fake reader and hand-run timers:
 * it learns the timeline from the Scene on screen; a history reads nothing; a live scope's cached days (its own
 * scope's, under their keys; a "now" copy only while it is the latest day) are listed first; the view's day is read
 * once it rests (debounced), its neighbours at idle in the direction of travel; at most two reads in flight; moving
 * away cancels; a failure is kept and not retried by prefetch; a day read becomes drawable (the scene key names it);
 * a day another tab stored after the listing is taken from the cache, not read again; and it says why days cannot be
 * read (demo mode, no sign-in, another scope).
 */
import type { Layout } from '@gcportrait/layout';
import { describe, expect, it } from 'vitest';

import { SIGNED_OUT_SESSION } from '../auth/types';
import type { SceneAnswer, SceneSource } from '../diagram/pipeline/protocol';
import type { ImportProgress } from '../import/progress';
import { IDLE_PROGRESS } from '../import/progress';
import { readyConnect } from '../preflight/testing';
import { createAppStore, selectSceneKey, type AppStore, type ConnectSlice } from '../state';
import type { StoredTick, TickCacheStore } from '../storage/tickCache';
import { createTimelineController, liveAccess, liveTickKey } from './controller';
import { TickReadFailed, type TickJob } from './fetchTick';
import { APP_NOW as NOW, historyInfo, LIVE_INFO as LIVE, settled, storedTick } from './testing/fixtures';

const REF = '01J0000000000000000000000A';
const OTHER_REF = '01J0000000000000000000000B';
const HISTORY = historyInfo();

/** The `connect` slice once organisation `scopeId` (by default the live scope's) was checked and found ready. */
function connect(scopeId = LIVE.scope.id): ConnectSlice {
  return readyConnect({ kind: 'organization', scope: `organizations/${scopeId}`, id: scopeId });
}

/** Puts a Scene answer for `source` on screen, as the pipeline would. */
function onScreen(store: AppStore, source: Partial<SceneSource> & { readonly ref: string }): void {
  const answer = {
    source: { scope: 'example.com', readTime: LIVE.readTime, assets: 1, ...source },
  } as unknown as SceneAnswer;
  store.updatePipeline((current) => ({
    ...current,
    result: { key: 'k', answer, layout: {} as unknown as Layout },
  }));
}

/** Day `day` of a live scope as the tick cache keeps it, under the controller's own key. */
function record(day: string, extra: Partial<StoredTick> = {}, info = LIVE): StoredTick {
  return storedTick(info.scopePath, day, { key: liveTickKey(info, day), ...extra });
}

interface Read {
  readonly job: TickJob;
  readonly signal: AbortSignal;
  readonly progress: (progress: ImportProgress) => void;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

function setup(
  options: { readonly hash?: string; readonly cached?: readonly StoredTick[]; readonly demo?: boolean } = {},
) {
  const store = createAppStore({
    location: { pathname: '/diagram', hash: options.hash ?? `#snapshot=${REF}` },
  });
  const reads: Read[] = [];
  const delays: (() => void)[] = [];
  const idles: (() => void)[] = [];
  const kept = new Map((options.cached ?? []).map((entry) => [entry.key, entry]));
  const cache: TickCacheStore = {
    get: (key) => Promise.resolve(kept.get(key)),
    put: () => Promise.resolve(),
    listScope: (scope) => Promise.resolve([...kept.values()].filter((entry) => entry.scope === scope)),
    persistent: () => Promise.resolve(true),
  };
  /** Another tab of the browser stores a day, behind this controller's back. */
  const storedElsewhere = (entry: StoredTick): void => {
    kept.set(entry.key, entry);
  };
  const controller = createTimelineController({
    store,
    cache,
    demo: options.demo ?? false,
    clock: () => NOW,
    fetchTick: (job, signal, progress) =>
      new Promise<void>((resolve, reject) => {
        reads.push({ job, signal, progress, resolve, reject });
      }),
    delay: (callback) => {
      delays.push(callback);
      return () => {
        const index = delays.indexOf(callback);
        if (index >= 0) delays.splice(index, 1);
      };
    },
    idle: (callback) => {
      idles.push(callback);
      return () => {
        const index = idles.indexOf(callback);
        if (index >= 0) idles.splice(index, 1);
      };
    },
  });
  // Every fake here answers at once, so one turn of the event loop lets the controller hear all of them.
  const flush = settled;
  const rest = (): void => {
    for (const callback of delays.splice(0)) callback();
  };
  const idle = (): void => {
    for (const callback of idles.splice(0)) callback();
  };
  const days = (): string[] => reads.filter((read) => !read.signal.aborted).map((read) => read.job.day);
  const moveTo = (day: string | null): void => {
    store.actions.setView((spec) => {
      const next = { ...spec };
      if (day === null) delete next.tick;
      else next.tick = day;
      return next;
    });
  };
  return { store, controller, reads, flush, rest, idle, days, moveTo, delays, storedElsewhere };
}

describe('learning the timeline', () => {
  it('takes it from the Scene on screen: a history ends on its last day and reads nothing', async () => {
    const { store, controller, reads, flush, rest, idle, moveTo } = setup({ hash: '#snapshot=demo:M' });
    controller.start();
    expect(store.getState().timeline.info).toBeNull();
    onScreen(store, { ref: 'demo:M', timeline: HISTORY });
    expect(store.getState().timeline).toMatchObject({ info: HISTORY, today: '2026-10-08', now: null });
    moveTo('2026-09-20');
    await flush();
    rest();
    idle();
    expect(reads).toEqual([]);
    controller.stop();
  });

  it('ends a live scope’s timeline on the app’s day and lists its cached days under its own keys', async () => {
    const other = { ...LIVE, scopePath: 'folders/20000000001' };
    const { store, controller, flush } = setup({
      cached: [
        record('2026-10-01'),
        record('2026-10-09', { now: true }),
        record('2026-10-10', { now: true }),
        record('2026-10-02', {}, other),
        record('2026-10-03', { key: 'another key' }),
      ],
    });
    controller.start();
    onScreen(store, { ref: REF, timeline: LIVE });
    await flush();
    const { timeline } = store.getState();
    expect(timeline).toMatchObject({ today: '2026-10-10', now: NOW });
    // Nobody signed in here: the cached days can be drawn, other days cannot be read.
    expect(timeline.blocked).toMatch(/Sign in with Google first on the Connect page\.$/);
    // A "now" copy counts only while its day is the latest; another scope's or key's never.
    expect(timeline.status).toEqual({ '2026-10-01': 'cached', '2026-10-10': 'cached' });
    controller.stop();
  });
});

describe('reading a live scope’s days', () => {
  async function started(hash = `#snapshot=${REF}`) {
    const harness = setup({ hash, cached: [record('2026-10-05')] });
    harness.store.updateConnect(() => connect());
    harness.controller.start();
    onScreen(harness.store, { ref: REF, timeline: LIVE });
    await harness.flush();
    return harness;
  }

  it('reads the view’s day once it rests, then its neighbours at idle, the direction of travel first', async () => {
    const { store, reads, flush, rest, idle, days, moveTo, controller } = await started();
    moveTo('2026-10-03');
    moveTo('2026-10-02');
    expect(reads).toEqual([]);
    rest();
    // The cache is asked first: the day is being read from then on.
    expect(store.getState().timeline.status['2026-10-02']).toBe('loading');
    await flush();
    expect(days()).toEqual(['2026-10-02']);
    expect(reads[0]?.job).toMatchObject({
      day: '2026-10-02',
      readTime: '2026-10-02T00:00:00Z',
      key: liveTickKey(LIVE, '2026-10-02'),
      scopePath: 'organizations/30000000001',
      target: { mode: 'user', quotaProject: 'demo-quota-1' },
      today: '2026-10-10',
    });
    expect(store.getState().timeline.status['2026-10-02']).toBe('loading');
    idle();
    await flush();
    // Two in flight at most: the older neighbour (the way the view moved) waits for one to end.
    expect(days()).toEqual(['2026-10-02', '2026-10-01']);
    reads[0]?.resolve();
    await settled();
    expect(days()).toEqual(['2026-10-02', '2026-10-01', '2026-10-03']);
    expect(store.getState().timeline.status['2026-10-02']).toBe('cached');
    controller.stop();
  });

  it('never reads the snapshot’s own day or a cached one, and reads the latest day at "now"', async () => {
    const { flush, rest, idle, days, moveTo, reads, controller } = await started();
    moveTo('2026-10-05');
    rest();
    idle();
    await flush();
    expect(days()).toEqual(['2026-10-04', '2026-10-06']);
    moveTo(null);
    rest();
    idle();
    await flush();
    expect(days()).toEqual(['2026-10-06', '2026-10-08']);
    moveTo('2026-10-10');
    rest();
    await flush();
    expect(reads.at(-1)?.job).toMatchObject({ day: '2026-10-10', readTime: null });
    controller.stop();
  });

  it('reads nothing, not even at idle, while the view stays where the page opened it on the snapshot’s own day', async () => {
    const { reads, flush, rest, idle, controller } = await started();
    rest();
    idle();
    await flush();
    expect(reads).toEqual([]);
    controller.stop();
  });

  it('cancels a read the view moved away from', async () => {
    const { store, reads, flush, rest, moveTo, controller } = await started();
    moveTo('2026-09-20');
    rest();
    await flush();
    expect(reads[0]?.job.day).toBe('2026-09-20');
    moveTo('2026-09-10');
    expect(reads[0]?.signal.aborted).toBe(true);
    expect(store.getState().timeline.status['2026-09-20']).toBeUndefined();
    controller.stop();
  });

  it('makes a day drawable once read: the scene key names it, and shows the read’s progress', async () => {
    const { store, reads, flush, rest, moveTo, controller } = await started();
    moveTo('2026-10-02');
    expect(selectSceneKey(store.getState())).not.toContain('tick=');
    rest();
    await flush();
    reads[0]?.progress({
      ...IDLE_PROGRESS,
      phase: 'reading',
      kind: 'pull',
      pages: 2,
      assets: 900,
      bytes: 1_200_000,
    });
    expect(store.getState().timeline.progress).toMatchObject({
      day: '2026-10-02',
      progress: { assets: 900 },
    });
    reads[0]?.resolve();
    await settled();
    expect(selectSceneKey(store.getState())).toContain('tick=2026-10-02');
    expect(store.getState().timeline.progress).toBeNull();
    controller.stop();
  });

  it('keeps a failure, never retries it at idle, and reads it again when the view comes back or on retry', async () => {
    const { store, reads, flush, rest, idle, days, moveTo, controller } = await started();
    moveTo('2026-10-02');
    rest();
    await flush();
    reads[0]?.reject(
      new TickReadFailed({ title: 'You cannot read example.com.', message: 'Permission denied.' }),
    );
    await settled();
    expect(store.getState().timeline.status['2026-10-02']).toBe('error');
    expect(store.getState().timeline.failures['2026-10-02']?.message).toBe('Permission denied.');
    moveTo('2026-10-03');
    rest();
    idle();
    await flush();
    expect(days().filter((day) => day === '2026-10-02')).toHaveLength(1);
    moveTo('2026-10-02');
    rest();
    await flush();
    expect(days().filter((day) => day === '2026-10-02')).toHaveLength(2);
    controller.retry('2026-10-02');
    await flush();
    expect(reads.filter((read) => read.job.day === '2026-10-02')).toHaveLength(2);
    controller.stop();
  });

  it('forgets everything when the snapshot changes', async () => {
    const { store, reads, flush, rest, moveTo, controller } = await started();
    moveTo('2026-10-02');
    rest();
    await flush();
    store.actions.setSnapshot(OTHER_REF);
    expect(reads[0]?.signal.aborted).toBe(true);
    expect(store.getState().timeline).toMatchObject({ ref: OTHER_REF, info: null, status: {} });
    controller.stop();
  });
});

describe('a day another tab of the browser stored after the cached days were listed', () => {
  async function started() {
    const harness = setup();
    harness.store.updateConnect(() => connect());
    harness.controller.start();
    onScreen(harness.store, { ref: REF, timeline: LIVE });
    await harness.flush();
    return harness;
  }

  it('is taken from the cache when the view rests on it, without a fetch; its neighbours come next', async () => {
    const { store, flush, rest, idle, days, moveTo, storedElsewhere, controller } = await started();
    expect(store.getState().timeline.status).toEqual({});
    storedElsewhere(record('2026-10-02'));
    storedElsewhere(record('2026-10-01'));
    moveTo('2026-10-02');
    rest();
    await flush();
    expect(days()).toEqual([]);
    expect(store.getState().timeline.status).toEqual({ '2026-10-02': 'cached' });
    expect(selectSceneKey(store.getState())).toContain('tick=2026-10-02');
    // At idle the neighbours: the older one (the way the view moved) is taken from the cache too, the newer one read.
    idle();
    await flush();
    expect(days()).toEqual(['2026-10-03']);
    expect(store.getState().timeline.status).toEqual({
      '2026-10-01': 'cached',
      '2026-10-02': 'cached',
      '2026-10-03': 'loading',
    });
    controller.stop();
  });

  it('is taken from the cache on "Try again" after a failure', async () => {
    const { store, reads, flush, rest, moveTo, storedElsewhere, controller } = await started();
    moveTo('2026-10-02');
    rest();
    await flush();
    reads[0]?.reject(new TickReadFailed({ title: 'Google Cloud did not answer.', message: 'Unavailable.' }));
    await settled();
    expect(store.getState().timeline.status['2026-10-02']).toBe('error');
    storedElsewhere(record('2026-10-02'));
    controller.retry('2026-10-02');
    await flush();
    // Its neighbours are read with it, the day itself not again.
    expect(reads.map((read) => read.job.day)).toEqual(['2026-10-02', '2026-10-01', '2026-10-03']);
    expect(store.getState().timeline.status['2026-10-02']).toBe('cached');
    expect(store.getState().timeline.failures).toEqual({});
    controller.stop();
  });

  it('counts only under its own scope’s key, and a "now" copy only while it is the latest day', async () => {
    const other = { ...LIVE, scopePath: 'folders/20000000001' };
    const { reads, flush, rest, days, moveTo, storedElsewhere, controller } = await started();
    storedElsewhere(record('2026-10-04', {}, other));
    storedElsewhere(record('2026-10-03', { now: true }));
    storedElsewhere(record('2026-10-10', { now: true }));
    moveTo('2026-10-04');
    rest();
    await flush();
    moveTo('2026-10-03');
    rest();
    await flush();
    // Both read from Google Cloud, the "now" copy's day again as of its 00:00 UTC.
    expect(days()).toEqual(['2026-10-04', '2026-10-03']);
    expect(reads.at(-1)?.job.readTime).toBe('2026-10-03T00:00:00Z');
    // The latest day's "now" copy counts.
    moveTo('2026-10-10');
    rest();
    await flush();
    expect(reads.map((read) => read.job.day)).toEqual(['2026-10-04', '2026-10-03']);
    controller.stop();
  });

  it('is neither fetched nor counted when the view moves away while the cache is asked', async () => {
    const { store, reads, flush, rest, moveTo, controller } = await started();
    moveTo('2026-10-02');
    rest();
    moveTo('2026-09-20');
    await flush();
    expect(reads).toEqual([]);
    expect(store.getState().timeline.status).toEqual({});
    controller.stop();
  });
});

describe('when reading becomes possible', () => {
  it('reads the view’s day without waiting for it to move', async () => {
    const { store, controller, flush, rest, days } = setup({ hash: `#snapshot=${REF}&tick=2026-10-02` });
    controller.start();
    onScreen(store, { ref: REF, timeline: LIVE });
    await flush();
    rest();
    await flush();
    expect(days()).toEqual([]);
    expect(store.getState().timeline.blocked).not.toBeNull();
    // The person signs in and checks the scope on the Connect page.
    store.updateConnect(() => connect());
    expect(store.getState().timeline.blocked).toBeNull();
    rest();
    await flush();
    expect(days()).toEqual(['2026-10-02']);
    controller.stop();
  });
});

describe('why days cannot be read', () => {
  it('says so in demo mode, without a sign-in, and for a check of another scope; reads nothing then', async () => {
    const { store, controller, flush, rest, idle, moveTo, reads } = setup({ demo: true });
    controller.start();
    onScreen(store, { ref: REF, timeline: LIVE });
    await flush();
    expect(store.getState().timeline.blocked).toMatch(/^This demo instance reads nothing from Google Cloud/);
    moveTo('2026-10-02');
    rest();
    idle();
    await flush();
    expect(reads).toEqual([]);
    controller.stop();
    const signedOut = { ...connect(), session: SIGNED_OUT_SESSION };
    expect(liveAccess(signedOut, LIVE, false).blocked).toBe(
      'Reading other days of example.com needs Google Cloud: Sign in with Google first on the Connect page.',
    );
    expect(liveAccess(connect('30000000002'), LIVE, false)).toEqual({
      target: null,
      blocked: 'Reading other days of example.com needs its permission check: choose it on the Connect page.',
    });
    expect(liveAccess(connect(), LIVE, false)).toEqual({
      target: { mode: 'user', quotaProject: 'demo-quota-1' },
      blocked: null,
    });
  });
});
