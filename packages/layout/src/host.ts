// SPDX-License-Identifier: Apache-2.0
/**
 * How the layout worker pauses between steps. A layout runs in steps (steps.ts); between two
 * steps the worker yields to its host's task queue, so that a message posted meanwhile (a newer request, a
 * cancel) is handled before the next step and can cancel the running layout. A microtask (`await` on a
 * resolved promise) would not do: messages are tasks, and tasks wait until the microtask queue is empty.
 *
 * The host APIs are typed structurally (the package compiles without DOM and Node types). In order of
 * preference: `setImmediate` (Node, also inside `worker_threads`: runs after pending I/O, including port
 * messages), a private `MessageChannel` (browsers and Web Workers: a message task, which unlike
 * `setTimeout(0)` is not clamped to 4 ms when nested), `setTimeout(0)`; failing all three, a resolved promise
 * (layouts then still run, but a newer request waits until the current one finishes). This module is the
 * package's only use of host scheduling; it reads no clock and no randomness.
 */

/** The part of a `MessagePort` the channel yield uses. */
export interface PortLike {
  onmessage: ((event: unknown) => void) | null;
  postMessage(message: unknown): void;
}

/** The scheduling APIs a host may offer (`globalThis` in a browser, a Web Worker or Node). */
export interface HostScheduler {
  readonly setImmediate?: (callback: () => void) => unknown;
  readonly MessageChannel?: new () => { readonly port1: PortLike; readonly port2: PortLike };
  readonly setTimeout?: (callback: () => void, delay: number) => unknown;
}

/** Which mechanism {@link createHostYield} chose. */
export type HostYieldKind = 'immediate' | 'channel' | 'timeout' | 'microtask';

/** A function that resolves after the host has had a chance to run pending tasks, and how it does so. */
export interface HostYield {
  readonly kind: HostYieldKind;
  readonly yieldToHost: () => Promise<void>;
}

/** The best way to yield to `host`'s task queue (default: the global object). */
export function createHostYield(host: HostScheduler = globalThis as unknown as HostScheduler): HostYield {
  if (typeof host.setImmediate === 'function') {
    return {
      kind: 'immediate',
      yieldToHost: () =>
        new Promise((resolve) => {
          host.setImmediate?.(resolve);
        }),
    };
  }
  if (typeof host.MessageChannel === 'function') {
    // One channel for every yield: each posted message resumes the oldest waiting yield.
    const channel = new host.MessageChannel();
    const waiting: (() => void)[] = [];
    channel.port1.onmessage = () => {
      waiting.shift()?.();
    };
    return {
      kind: 'channel',
      yieldToHost: () =>
        new Promise((resolve) => {
          waiting.push(resolve);
          channel.port2.postMessage(null);
        }),
    };
  }
  if (typeof host.setTimeout === 'function') {
    return {
      kind: 'timeout',
      yieldToHost: () =>
        new Promise((resolve) => {
          host.setTimeout?.(resolve, 0);
        }),
    };
  }
  return { kind: 'microtask', yieldToHost: () => Promise.resolve() };
}
