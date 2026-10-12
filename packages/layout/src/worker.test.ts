// SPDX-License-Identifier: MIT
/**
 * The worker side of the layout protocol (worker.ts), run in-process with a host whose task queue the test
 * drives by hand: every request ends in exactly one result, cancelled or error; a superseded or cancelled
 * request never posts a result (nor progress after its cancellation); the newest request does; memo hits are
 * answered at once with the stored Layout (byte-identical); a repeated request takes the running layout over;
 * errors name their ids; malformed messages are refused. The real-worker tests and the budgets are in
 * test/worker.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { layoutKey } from './hash.js';
import { layoutScene } from './layout.js';
import { manualYield } from './testing/host.js';
import { busyScene, card, scene, zone } from './testing/scenes.js';
import type { Layout, LayoutProgress } from './types.js';
import {
  createLayoutWorkerHandler,
  type LayoutWorkerEnvironment,
  type LayoutWorkerResponse,
} from './worker.js';

/**
 * A handler on a host whose task queue runs only when the test says so (`tick`, `settle`). Every message the
 * handler posts goes through `post` first, which may refuse it by throwing as a host's `postMessage` can; the
 * others are kept in `messages`.
 */
function harness(
  environment: Omit<LayoutWorkerEnvironment, 'yieldToHost'> = {},
  post: (message: LayoutWorkerResponse) => void = () => undefined,
) {
  const messages: LayoutWorkerResponse[] = [];
  const host = manualYield();
  const handle = createLayoutWorkerHandler(
    (message) => {
      post(message);
      messages.push(message);
    },
    { ...environment, yieldToHost: host.yieldToHost },
  );
  const of = (id: number): LayoutWorkerResponse[] => messages.filter((message) => message.id === id);
  const terminal = (id: number): LayoutWorkerResponse[] =>
    of(id).filter((message) => message.type !== 'progress');
  return { handle, messages, pending: host.pending, tick: host.tick, settle: host.settle, of, terminal };
}

function resultOf(messages: readonly LayoutWorkerResponse[]): Layout {
  const result = messages.find((message) => message.type === 'result');
  if (result?.type !== 'result') throw new Error('no result');
  return result.layout;
}

const SMALL = scene(
  [zone('p', 'project', [card('a'), card('b'), card('c')])],
  [
    { from: 'a', to: 'b', kind: 'uses' },
    { from: 'b', to: 'c', kind: 'routes' },
  ],
);
const OTHER = scene([zone('q', 'project', [card('x'), card('y')])], [{ from: 'x', to: 'y', kind: 'uses' }]);
const BUSY = busyScene(4, 12, 6);

describe('createLayoutWorkerHandler', () => {
  it('answers a request with its progress and one result: the Layout layoutScene computes', async () => {
    const worker = harness();
    worker.handle({ type: 'layout', id: 1, scene: BUSY });
    expect(worker.messages).toEqual([]); // nothing runs before the host yields
    await worker.settle();
    const messages = worker.of(1);
    const progress = messages.flatMap((message) => (message.type === 'progress' ? [message.progress] : []));
    expect(progress.slice(0, 3).map((step: LayoutProgress) => step.stage)).toEqual([
      'normalise',
      'size',
      'pack',
    ]);
    expect(progress.filter((step) => step.stage === 'route').length).toBeGreaterThan(3);
    expect(worker.terminal(1)).toHaveLength(1);
    const result = messages.at(-1);
    expect(result).toMatchObject({ type: 'result', id: 1, cached: false, key: layoutKey(BUSY) });
    expect(JSON.stringify(resultOf(messages))).toBe(JSON.stringify(layoutScene(BUSY)));
  });

  it('answers a repeated request from the memo at once, with the same Layout', async () => {
    const worker = harness();
    worker.handle({ type: 'layout', id: 1, scene: SMALL, options: { targetAspect: 1.5 } });
    await worker.settle();
    const first = resultOf(worker.of(1));
    // The same data with its keys in another order (as after postMessage or JSON): the same key.
    const reordered = JSON.parse(JSON.stringify({ options: { targetAspect: 1.5 }, scene: SMALL })) as {
      scene: typeof SMALL;
    };
    worker.handle({ type: 'layout', id: 2, options: { targetAspect: 1.5 }, scene: reordered.scene });
    // Synchronous: no step of the host ran.
    expect(worker.of(2)).toEqual([
      { type: 'result', id: 2, key: layoutKey(SMALL, { targetAspect: 1.5 }), cached: true, layout: first },
    ]);
    expect(resultOf(worker.of(2))).toBe(first);
    expect(worker.pending).toHaveLength(0);
  });

  it('answers a Scene that differs only in its metadata (another timeline day’s read time) from the memo', async () => {
    // Timeline days whose Scenes differ only in their metadata share a Layout.
    const worker = harness();
    worker.handle({ type: 'layout', id: 1, scene: SMALL });
    await worker.settle();
    const first = resultOf(worker.of(1));
    const otherDay = { ...SMALL, metadata: { ...SMALL.metadata, readTime: '2026-09-17T00:00:00Z' } };
    worker.handle({ type: 'layout', id: 2, scene: otherDay });
    expect(worker.of(2)).toEqual([
      { type: 'result', id: 2, key: layoutKey(SMALL), cached: true, layout: first },
    ]);
  });

  it('cancels a superseded request at once; it never posts a result, the newer one does', async () => {
    const worker = harness();
    worker.handle({ type: 'layout', id: 1, scene: BUSY });
    for (let i = 0; i < 5; i += 1) await worker.tick();
    expect(worker.of(1).length).toBeGreaterThan(0);
    worker.handle({ type: 'layout', id: 2, scene: OTHER });
    expect(worker.messages.at(-1)).toEqual({ type: 'cancelled', id: 1, reason: 'superseded' });
    const before = worker.of(1).length;
    await worker.settle();
    // Nothing more for request 1: no progress, no result.
    expect(worker.of(1)).toHaveLength(before);
    expect(worker.terminal(1)).toEqual([{ type: 'cancelled', id: 1, reason: 'superseded' }]);
    expect(worker.terminal(2)).toHaveLength(1);
    expect(JSON.stringify(resultOf(worker.of(2)))).toBe(JSON.stringify(layoutScene(OTHER)));
  });

  it('lays out only the last of a burst of requests', async () => {
    const worker = harness();
    worker.handle({ type: 'layout', id: 1, scene: BUSY });
    worker.handle({ type: 'layout', id: 2, scene: SMALL });
    worker.handle({ type: 'layout', id: 3, scene: OTHER });
    await worker.settle();
    expect(worker.of(1)).toEqual([{ type: 'cancelled', id: 1, reason: 'superseded' }]);
    expect(worker.of(2)).toEqual([{ type: 'cancelled', id: 2, reason: 'superseded' }]);
    expect(worker.terminal(3)).toMatchObject([{ type: 'result', id: 3, cached: false }]);
  });

  it('cancels on request; the cancelled layout stops at its next step', async () => {
    const worker = harness();
    worker.handle({ type: 'layout', id: 1, scene: BUSY });
    await worker.tick();
    await worker.tick();
    worker.handle({ type: 'cancel', id: 1 });
    expect(worker.messages.at(-1)).toEqual({ type: 'cancelled', id: 1, reason: 'cancelled' });
    const before = worker.of(1).length;
    await worker.settle();
    expect(worker.of(1)).toHaveLength(before);
    expect(worker.terminal(1)).toEqual([{ type: 'cancelled', id: 1, reason: 'cancelled' }]);
    // A second cancel, a cancel for an unknown id and one for a finished request are ignored.
    worker.handle({ type: 'cancel', id: 1 });
    worker.handle({ type: 'cancel', id: 99 });
    worker.handle({ type: 'layout', id: 2, scene: SMALL });
    await worker.settle();
    worker.handle({ type: 'cancel', id: 2 });
    expect(worker.terminal(2)).toMatchObject([{ type: 'result', id: 2 }]);
    expect(worker.terminal(1)).toHaveLength(1);
    expect(worker.of(99)).toEqual([]);
  });

  it('lets a request with the same key take the running layout over instead of starting again', async () => {
    const worker = harness();
    worker.handle({ type: 'layout', id: 1, scene: BUSY });
    for (let i = 0; i < 4; i += 1) await worker.tick();
    worker.handle({ type: 'layout', id: 2, scene: BUSY });
    expect(worker.messages.at(-1)).toEqual({ type: 'cancelled', id: 1, reason: 'superseded' });
    await worker.settle();
    const progress2 = worker.of(2).filter((message) => message.type === 'progress');
    // Request 2 continued where request 1 was: it never saw the first stages.
    expect(progress2.some((message) => message.progress.stage === 'normalise')).toBe(false);
    expect(worker.terminal(1)).toEqual([{ type: 'cancelled', id: 1, reason: 'superseded' }]);
    expect(JSON.stringify(resultOf(worker.of(2)))).toBe(JSON.stringify(layoutScene(BUSY)));
  });

  it('revives a cancelled layout that is asked for again before its next step', async () => {
    const worker = harness();
    worker.handle({ type: 'layout', id: 1, scene: BUSY });
    for (let i = 0; i < 3; i += 1) await worker.tick();
    worker.handle({ type: 'cancel', id: 1 });
    worker.handle({ type: 'layout', id: 2, scene: BUSY });
    // Request 1 was already answered `cancelled`; no second answer for it.
    expect(worker.terminal(1)).toEqual([{ type: 'cancelled', id: 1, reason: 'cancelled' }]);
    await worker.settle();
    expect(worker.of(2).some((m) => m.type === 'progress' && m.progress.stage === 'normalise')).toBe(false);
    expect(worker.terminal(2)).toMatchObject([{ type: 'result', id: 2, cached: false }]);
  });

  it('starts afresh once a cancelled layout has been dropped, and after a superseding one with another key', async () => {
    const worker = harness();
    worker.handle({ type: 'layout', id: 1, scene: BUSY });
    await worker.tick();
    worker.handle({ type: 'cancel', id: 1 });
    await worker.tick(); // the layout notices and is dropped
    expect(worker.pending).toHaveLength(0);
    worker.handle({ type: 'layout', id: 2, scene: BUSY });
    await worker.tick();
    await worker.tick();
    worker.handle({ type: 'cancel', id: 2 });
    worker.handle({ type: 'layout', id: 3, scene: SMALL }); // supersedes the cancelled one: no second answer
    await worker.settle();
    expect(worker.of(2).some((m) => m.type === 'progress' && m.progress.stage === 'normalise')).toBe(true);
    expect(worker.terminal(2)).toEqual([{ type: 'cancelled', id: 2, reason: 'cancelled' }]);
    expect(worker.terminal(3)).toMatchObject([{ type: 'result', id: 3 }]);
  });

  it('keeps the eight most recent Layouts', async () => {
    const worker = harness();
    const variant = (i: number) => scene([card(`c${String(i)}`)]);
    for (let i = 0; i < 9; i += 1) {
      worker.handle({ type: 'layout', id: i + 1, scene: variant(i) });
      await worker.settle();
    }
    worker.handle({ type: 'layout', id: 20, scene: variant(8) });
    worker.handle({ type: 'layout', id: 21, scene: variant(1) });
    worker.handle({ type: 'layout', id: 22, scene: variant(0) }); // evicted by the ninth
    expect(worker.terminal(20)).toMatchObject([{ type: 'result', cached: true }]);
    expect(worker.terminal(21)).toMatchObject([{ type: 'result', cached: true }]);
    expect(worker.terminal(22)).toEqual([]);
    await worker.settle();
    expect(worker.terminal(22)).toMatchObject([{ type: 'result', cached: false }]);
  });

  it('memoises nothing with memoCapacity 0, and adds timings with a clock', async () => {
    let now = 0;
    const worker = harness({ memoCapacity: 0, clock: () => (now += 1) });
    worker.handle({ type: 'layout', id: 1, scene: SMALL });
    await worker.settle();
    worker.handle({ type: 'layout', id: 2, scene: SMALL });
    await worker.settle();
    expect(worker.terminal(2)).toMatchObject([{ type: 'result', cached: false }]);
    expect(resultOf(worker.of(2)).report.timings?.total).toBeGreaterThan(0);
  });

  it('answers a refused Scene or option with its code and ids', async () => {
    const worker = harness();
    worker.handle({ type: 'layout', id: 1, scene: scene([card('a'), card('a')]) });
    worker.handle({ type: 'layout', id: 2, scene: SMALL, options: { targetAspect: -1 } });
    const cyclic = zone('loop', 'folder', []);
    cyclic.children.push(cyclic);
    worker.handle({ type: 'layout', id: 3, scene: { ...SMALL, edges: [], children: [cyclic] } });
    await worker.settle();
    expect(worker.terminal(1)).toEqual([{ type: 'cancelled', id: 1, reason: 'superseded' }]);
    expect(worker.terminal(2)).toEqual([{ type: 'cancelled', id: 2, reason: 'superseded' }]);
    expect(worker.terminal(3)).toMatchObject([
      { type: 'error', id: 3, error: { code: 'cycle', ids: ['loop', 'loop'] } },
    ]);
    worker.handle({ type: 'layout', id: 4, scene: scene([card('a'), card('a')]) });
    await worker.settle();
    expect(worker.terminal(4)).toMatchObject([
      { type: 'error', error: { code: 'duplicate-id', ids: ['a'] } },
    ]);
    worker.handle({ type: 'layout', id: 5, scene: SMALL, options: { targetAspect: -1 } });
    await worker.settle();
    expect(worker.terminal(5)).toMatchObject([
      { type: 'error', error: { code: 'invalid-option', ids: ['targetAspect'] } },
    ]);
    // The worker carries on.
    worker.handle({ type: 'layout', id: 6, scene: SMALL });
    await worker.settle();
    expect(worker.terminal(6)).toMatchObject([{ type: 'result' }]);
  });

  it('refuses malformed messages with a protocol error', () => {
    const worker = harness();
    const cases: [unknown, number | null][] = [
      [null, null],
      ['layout', null],
      [[1], null],
      [{ type: 'layout', scene: SMALL }, null],
      [{ type: 'layout', id: -1, scene: SMALL }, null],
      [{ type: 'layout', id: 1.5, scene: SMALL }, null],
      [{ type: 'paint', id: 7 }, 7],
      [{ type: 'layout', id: 8 }, 8],
      [{ type: 'layout', id: 9, scene: { children: [], edges: [] } }, 9],
      [{ type: 'layout', id: 10, scene: { children: {}, edges: [], metadata: {} } }, 10],
      [{ type: 'layout', id: 11, scene: SMALL, options: 'fast' }, 11],
      [{ type: 'layout', id: 12, scene: SMALL, options: null }, 12],
    ];
    for (const [message] of cases) worker.handle(message);
    expect(worker.messages).toHaveLength(cases.length);
    worker.messages.forEach((message, index) => {
      expect(message).toMatchObject({
        type: 'error',
        id: cases[index]?.[1],
        error: { code: 'protocol', ids: [] },
      });
    });
  });

  it('reports what it did not expect as an internal error', () => {
    const worker = harness();
    // readRequest reads `metadata`; this getter throws there.
    const hostile = {
      ...SMALL,
      get metadata(): never {
        throw new Error('getter');
      },
    };
    worker.handle({ type: 'layout', id: 1, scene: hostile });
    expect(worker.terminal(1)).toEqual([
      { type: 'error', id: 1, error: { code: 'internal', message: 'getter', ids: [] } },
    ]);
    // The memo key reads every key of the Scene's tree; this object refuses to list its keys.
    const unlisted = new Proxy(
      {},
      {
        ownKeys: () => {
          throw new Error('keys');
        },
      },
    );
    worker.handle({ type: 'layout', id: 2, scene: { ...SMALL, edges: [unlisted] } });
    expect(worker.terminal(2)).toEqual([
      { type: 'error', id: 2, error: { code: 'internal', message: 'keys', ids: [] } },
    ]);
  });

  it('ends a request in an error when the host cannot post its result', async () => {
    for (const failure of [new Error('cannot clone'), 'no']) {
      const worker = harness({}, (message) => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- a host may throw anything
        if (message.type === 'result') throw failure;
      });
      worker.handle({ type: 'layout', id: 3, scene: SMALL });
      await worker.settle();
      expect(worker.terminal(3)).toEqual([
        {
          type: 'error',
          id: 3,
          error: { code: 'internal', message: failure instanceof Error ? failure.message : failure, ids: [] },
        },
      ]);
      // The handler is free for the next request.
      worker.handle({ type: 'layout', id: 4, scene: OTHER });
      expect(worker.pending).toHaveLength(1);
    }
  });

  it('lays out a request without a memo key and does not memoise it', async () => {
    const worker = harness();
    // In-process a caller could pass a function as an option; it has no structural hash.
    const options = { clock: () => 0 } as unknown as Record<string, unknown>;
    worker.handle({ type: 'layout', id: 1, scene: SMALL, options });
    await worker.settle();
    worker.handle({ type: 'layout', id: 2, scene: SMALL, options });
    await worker.settle();
    expect(worker.terminal(1)).toMatchObject([{ type: 'result', key: null, cached: false }]);
    expect(worker.terminal(2)).toMatchObject([{ type: 'result', key: null, cached: false }]);
  });

  it('ends a request in an error when the host cannot post its progress, and carries on', async () => {
    let refuse = true;
    const worker = harness({}, (message) => {
      if (message.type === 'progress' && refuse) {
        refuse = false;
        throw new Error('port closed');
      }
    });
    worker.handle({ type: 'layout', id: 1, scene: SMALL });
    await worker.settle();
    expect(worker.messages).toEqual([
      { type: 'error', id: 1, error: { code: 'internal', message: 'port closed', ids: [] } },
    ]);
    worker.handle({ type: 'layout', id: 2, scene: SMALL });
    await worker.settle();
    expect(worker.of(2).at(-1)).toMatchObject({ type: 'result', cached: false });
  });

  it('yields through the host by default', async () => {
    const answer = new Promise<LayoutWorkerResponse>((resolve) => {
      const handle = createLayoutWorkerHandler((message) => {
        if (message.type !== 'progress') resolve(message);
      });
      handle({ type: 'layout', id: 1, scene: SMALL });
    });
    await expect(answer).resolves.toMatchObject({ type: 'result', id: 1, cached: false });
  });
});
