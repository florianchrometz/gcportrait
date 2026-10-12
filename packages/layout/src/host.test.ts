// SPDX-License-Identifier: MIT
/**
 * The yield between layout steps (host.ts): each host mechanism resumes after the host's queued tasks, the
 * channel yield resumes its waiters in order, and the default picks `setImmediate` where it exists (Node).
 */
import { describe, expect, it } from 'vitest';
import { createHostYield, type HostScheduler, type PortLike } from './host.js';
import { flushMicrotasks as flush } from './testing/host.js';

/** A host whose task queue the test runs by hand. */
function manualHost(): { tasks: (() => void)[]; run: () => void } {
  const tasks: (() => void)[] = [];
  return {
    tasks,
    run: () => {
      for (let task = tasks.shift(); task !== undefined; task = tasks.shift()) task();
    },
  };
}

describe('createHostYield', () => {
  it('uses setImmediate in Node (the default host)', async () => {
    const { kind, yieldToHost } = createHostYield();
    expect(kind).toBe('immediate');
    await expect(yieldToHost()).resolves.toBeUndefined();
  });

  it('prefers setImmediate, and resumes only once the host runs its task', async () => {
    const queue = manualHost();
    const host: HostScheduler = {
      setImmediate: (callback) => queue.tasks.push(callback),
      setTimeout: () => {
        throw new Error('not used');
      },
    };
    const { kind, yieldToHost } = createHostYield(host);
    expect(kind).toBe('immediate');
    let resumed = false;
    void yieldToHost().then(() => {
      resumed = true;
    });
    await flush();
    expect(resumed).toBe(false);
    queue.run();
    await flush();
    expect(resumed).toBe(true);
  });

  it('uses one MessageChannel without setImmediate, resuming its waiters in order', async () => {
    const queue = manualHost();
    class FakeChannel {
      readonly port1: PortLike = { onmessage: null, postMessage: () => undefined };
      readonly port2: PortLike = {
        onmessage: null,
        postMessage: () => {
          queue.tasks.push(() => this.port1.onmessage?.({ data: null }));
        },
      };
    }
    const channels: FakeChannel[] = [];
    const host: HostScheduler = {
      MessageChannel: class extends FakeChannel {
        constructor() {
          super();
          channels.push(this);
        }
      },
    };
    const { kind, yieldToHost } = createHostYield(host);
    expect(kind).toBe('channel');
    const order: number[] = [];
    void yieldToHost().then(() => order.push(1));
    void yieldToHost().then(() => order.push(2));
    await flush();
    expect(order).toEqual([]);
    queue.run();
    await flush();
    expect(order).toEqual([1, 2]);
    expect(channels).toHaveLength(1);
    // A stray message with nobody waiting is harmless.
    expect(() => channels[0]?.port1.onmessage?.({ data: null })).not.toThrow();
  });

  it('falls back to setTimeout(0), then to a resolved promise', async () => {
    const queue = manualHost();
    const delays: number[] = [];
    const timeout = createHostYield({
      setTimeout: (callback, delay) => {
        delays.push(delay);
        queue.tasks.push(callback);
      },
    });
    expect(timeout.kind).toBe('timeout');
    let resumed = false;
    void timeout.yieldToHost().then(() => {
      resumed = true;
    });
    await flush();
    expect(resumed).toBe(false);
    queue.run();
    await flush();
    expect(resumed).toBe(true);
    expect(delays).toEqual([0]);

    const micro = createHostYield({});
    expect(micro.kind).toBe('microtask');
    await expect(micro.yieldToHost()).resolves.toBeUndefined();
  });
});
