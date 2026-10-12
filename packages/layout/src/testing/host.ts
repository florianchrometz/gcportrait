// SPDX-License-Identifier: MIT
/**
 * Test helpers (not part of the public API) for the code that yields to its host between layout steps (host.ts,
 * worker.ts, client.ts): a flush that lets every pending promise settle, and a yield that resumes only when the
 * test runs the host.
 */

/**
 * Lets every pending microtask run, however long its chain: one turn of Node's event loop (`setImmediate`),
 * which runs only once the microtask queue is empty. Nothing the test drives by hand (a `manualYield`, a
 * hand-run task queue) runs in that turn, and no count of `await`s inside the code under test can outlast it.
 */
export function flushMicrotasks(): Promise<void> {
  // The package's sources and tests compile without Node types; vitest runs them on Node.
  const { setImmediate } = globalThis as unknown as { setImmediate: (callback: () => void) => unknown };
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

export interface ManualYield {
  /** The yield to hand to the code under test: it resolves only when the test runs the host. */
  readonly yieldToHost: () => Promise<void>;
  /** The resumptions waiting for the host, one per waiting layout. */
  readonly pending: readonly (() => void)[];
  /** The host runs once: every waiting layout runs one step. */
  readonly tick: () => Promise<void>;
  /** The host runs until no layout is waiting. */
  readonly settle: () => Promise<void>;
}

export function manualYield(): ManualYield {
  const pending: (() => void)[] = [];
  const tick = async (): Promise<void> => {
    for (const resume of pending.splice(0)) resume();
    await flushMicrotasks();
  };
  return {
    yieldToHost: () =>
      new Promise<void>((resolve) => {
        pending.push(resolve);
      }),
    pending,
    tick,
    settle: async () => {
      await flushMicrotasks();
      while (pending.length > 0) await tick();
    },
  };
}
