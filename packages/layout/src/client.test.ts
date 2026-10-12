// SPDX-License-Identifier: MIT
/**
 * The page side of the layout protocol (client.ts) against the real handler, in-process, on a host whose
 * task queue the test drives: a request resolves with its Layout and reports progress; a newer request, an
 * aborted signal, `cancel()` and `dispose()` reject it with a `LayoutCancelledError` and it never resolves,
 * even when its result arrives afterwards; the next request resolves; memo hits resolve at once with the same
 * Layout; worker errors reject with their code and ids.
 */
import { describe, expect, it } from 'vitest';
import {
  LayoutCancelledError,
  LayoutWorkerError,
  createLayoutClient,
  isLayoutCancelled,
  layoutClient,
  type AbortSignalLike,
  type LayoutResult,
  type MessageEventLike,
} from './client.js';
import { layoutScene } from './layout.js';
import { flushMicrotasks as flush, manualYield } from './testing/host.js';
import { busyScene, card, scene, zone } from './testing/scenes.js';
import type { LayoutProgress } from './types.js';
import { createLayoutWorkerHandler, type LayoutWorkerRequest, type LayoutWorkerResponse } from './worker.js';

/** A client wired to an in-process handler; the worker's host runs when the test ticks it. */
function wired() {
  const host = manualYield();
  const sent: LayoutWorkerRequest[] = [];
  const answers: LayoutWorkerResponse[] = [];
  let receive: (message: unknown) => void = () => undefined;
  const handle = createLayoutWorkerHandler(
    (message) => {
      answers.push(message);
      receive(message);
    },
    { yieldToHost: host.yieldToHost },
  );
  const client = createLayoutClient((request) => {
    sent.push(request);
    handle(request);
  });
  receive = client.receive;
  return { client, sent, answers, settle: host.settle, tick: host.tick };
}

/** An AbortSignal stand-in (the package's sources and tests compile without DOM types). */
function controller(): { signal: AbortSignalLike & { listeners: number }; abort: () => void } {
  const listeners = new Set<() => void>();
  const signal = {
    aborted: false,
    get listeners() {
      return listeners.size;
    },
    addEventListener: (_type: 'abort', listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: 'abort', listener: () => void) => {
      listeners.delete(listener);
    },
  };
  return {
    signal,
    abort: () => {
      signal.aborted = true;
      for (const listener of [...listeners]) listener();
    },
  };
}

/** Tracks a promise's outcome without letting a rejection go unhandled. */
function track(promise: Promise<LayoutResult>): { result?: LayoutResult; error?: unknown } {
  const outcome: { result?: LayoutResult; error?: unknown } = {};
  promise.then(
    (result) => {
      outcome.result = result;
    },
    (error: unknown) => {
      outcome.error = error;
    },
  );
  return outcome;
}

const SMALL = scene(
  [zone('p', 'project', [card('a'), card('b'), card('c')])],
  [{ from: 'a', to: 'b', kind: 'uses' }],
);
const BUSY = busyScene(4, 12, 6);

describe('LayoutClient', () => {
  it('resolves with the Layout and reports progress', async () => {
    const { client, settle, sent } = wired();
    const progress: LayoutProgress[] = [];
    const outcome = track(client.layout(BUSY, undefined, { onProgress: (step) => progress.push(step) }));
    expect(client.pending).toBe(1);
    await settle();
    expect(outcome.result).toMatchObject({ id: 1, cached: false });
    expect(JSON.stringify(outcome.result?.layout)).toBe(JSON.stringify(layoutScene(BUSY)));
    expect(progress[0]?.stage).toBe('normalise');
    expect(progress.at(-1)?.stage).toBe('route');
    expect(client.pending).toBe(0);
    expect(sent).toEqual([{ type: 'layout', id: 1, scene: BUSY }]);
  });

  it('rejects a superseded request at once and never resolves it; the newer one resolves', async () => {
    const { client, settle, tick, answers } = wired();
    const first = track(client.layout(BUSY));
    await tick();
    await tick();
    const second = track(client.layout(SMALL, { targetAspect: 1.5 }));
    await flush();
    expect(first.error).toBeInstanceOf(LayoutCancelledError);
    expect(first.error).toMatchObject({ id: 1, reason: 'superseded', name: 'LayoutCancelledError' });
    expect(isLayoutCancelled(first.error)).toBe(true);
    await settle();
    expect(first.result).toBeUndefined();
    expect(second.result).toMatchObject({ id: 2, cached: false });
    expect(answers.filter((answer) => answer.id === 1).at(-1)).toEqual({
      type: 'cancelled',
      id: 1,
      reason: 'superseded',
    });
  });

  it('never resolves a cancelled request even if its result arrives', async () => {
    const posted: LayoutWorkerRequest[] = [];
    const client = createLayoutClient((request) => posted.push(request));
    const outcome = track(client.layout(SMALL));
    client.cancel();
    await flush();
    expect(outcome.error).toMatchObject({ reason: 'cancelled', id: 1 });
    expect(posted.at(-1)).toEqual({ type: 'cancel', id: 1 });
    client.receive({ type: 'result', id: 1, key: 'k', cached: false, layout: layoutScene(SMALL) });
    await flush();
    expect(outcome.result).toBeUndefined();
  });

  it('answers memo hits at once with the same Layout', async () => {
    const { client, settle } = wired();
    const first = track(client.layout(SMALL));
    await settle();
    const second = track(client.layout(SMALL));
    await flush();
    expect(second.result).toMatchObject({ id: 2, cached: true, key: first.result?.key });
    expect(JSON.stringify(second.result?.layout)).toBe(JSON.stringify(first.result?.layout));
  });

  it('cancels on abort, removes its abort listener when settled, and ignores an aborted signal up front', async () => {
    const { client, settle, sent } = wired();
    const { signal, abort } = controller();
    const aborted = track(client.layout(BUSY, undefined, { signal }));
    expect(signal.listeners).toBe(1);
    abort();
    await flush();
    expect(aborted.error).toMatchObject({ reason: 'aborted', id: 1 });
    expect(sent.at(-1)).toEqual({ type: 'cancel', id: 1 });
    expect(signal.listeners).toBe(0);
    await settle();
    expect(aborted.result).toBeUndefined();

    // A request whose signal is already aborted is refused without posting or superseding anything.
    const running = track(client.layout(SMALL));
    const count = sent.length;
    const refused = track(client.layout(SMALL, undefined, { signal }));
    await flush();
    expect(refused.error).toMatchObject({ reason: 'aborted' });
    expect(sent).toHaveLength(count);
    await settle();
    expect(running.result).toMatchObject({ cached: false });

    // A signal that is never aborted loses its listener once the request resolves.
    const { signal: idle } = controller();
    const done = track(client.layout(SMALL, undefined, { signal: idle }));
    await settle();
    expect(done.result).toMatchObject({ cached: true });
    expect(idle.listeners).toBe(0);
  });

  it('ignores an abort that comes after the request settled (a signal that kept its listener)', async () => {
    const { client, settle, sent } = wired();
    let listener: (() => void) | undefined;
    const sticky: AbortSignalLike = {
      aborted: false,
      addEventListener: (_type, added) => {
        listener = added;
      },
      removeEventListener: () => undefined,
    };
    const outcome = track(client.layout(SMALL, undefined, { signal: sticky }));
    await settle();
    expect(outcome.result).toMatchObject({ cached: false });
    const count = sent.length;
    listener?.();
    await flush();
    expect(sent).toHaveLength(count);
    expect(outcome.error).toBeUndefined();
  });

  it('rejects with the worker error, its code and ids', async () => {
    const { client, settle } = wired();
    const outcome = track(client.layout(scene([card('a'), card('a')])));
    await settle();
    expect(outcome.error).toBeInstanceOf(LayoutWorkerError);
    expect(outcome.error).toMatchObject({
      code: 'duplicate-id',
      ids: ['a'],
      id: 1,
      name: 'LayoutWorkerError',
    });
    expect(isLayoutCancelled(outcome.error)).toBe(false);
  });

  it('rejects a request the host cannot post', async () => {
    let failure: unknown = new Error('DataCloneError');
    const client = createLayoutClient((request) => {
      if (request.type === 'layout') throw failure;
    });
    const first = track(client.layout(SMALL));
    await flush();
    expect(first.error).toMatchObject({ message: 'DataCloneError' });
    failure = 'closed';
    const second = track(client.layout(SMALL));
    await flush();
    expect(second.error).toMatchObject({ message: 'closed' });
    expect(client.pending).toBe(0);
  });

  it('takes a cancelled answer from the worker, ignores stray messages, and fails every pending request', async () => {
    const client = createLayoutClient(() => undefined);
    const outcome = track(client.layout(SMALL));
    for (const junk of [
      null,
      'x',
      { id: 'one' },
      { type: 'result' },
      { type: 'result', id: 7 },
      { type: 'what', id: 1 },
    ]) {
      client.receive(junk);
    }
    expect(client.pending).toBe(1);
    client.receive({ type: 'progress', id: 1, progress: { stage: 'pack', pass: 0, routed: 0, edges: 0 } });
    client.receive({ type: 'cancelled', id: 1, reason: 'cancelled' });
    await flush();
    expect(outcome.error).toMatchObject({ reason: 'cancelled' });
    const superseded = track(client.layout(SMALL));
    client.receive({ type: 'cancelled', id: 2, reason: 'superseded' });
    await flush();
    expect(superseded.error).toMatchObject({ reason: 'superseded' });
    const failed = track(client.layout(SMALL));
    client.fail('the worker terminated');
    await flush();
    expect(failed.error).toMatchObject({ code: 'internal', message: 'the worker terminated', ids: [] });
  });

  it('survives a host that cannot post a cancel', async () => {
    const client = createLayoutClient((request) => {
      if (request.type === 'cancel') throw new Error('closed');
    });
    const outcome = track(client.layout(SMALL));
    expect(() => {
      client.cancel();
    }).not.toThrow();
    await flush();
    expect(outcome.error).toMatchObject({ reason: 'cancelled' });
  });
});

describe('layoutClient', () => {
  it('connects to a Web Worker-like object and detaches on dispose', async () => {
    const listeners = new Set<(event: MessageEventLike) => void>();
    const host = manualYield();
    const handle = createLayoutWorkerHandler(
      (message) => {
        for (const listener of listeners) listener({ data: message });
      },
      { yieldToHost: host.yieldToHost },
    );
    const worker = {
      postMessage: (message: LayoutWorkerRequest) => {
        handle(message);
      },
      addEventListener: (_type: 'message', listener: (event: MessageEventLike) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: 'message', listener: (event: MessageEventLike) => void) => {
        listeners.delete(listener);
      },
    };
    const client = layoutClient(worker);
    expect(listeners.size).toBe(1);
    const outcome = track(client.layout(SMALL));
    await host.settle();
    expect(outcome.result).toMatchObject({ id: 1, cached: false });
    const pending = track(client.layout(busyScene(2, 4, 2)));
    client.dispose();
    client.dispose();
    await flush();
    expect(pending.error).toMatchObject({ reason: 'cancelled' });
    expect(listeners.size).toBe(0);
    const late = track(client.layout(SMALL));
    await flush();
    expect(late.error).toMatchObject({ reason: 'cancelled' });
  });
});
