// SPDX-License-Identifier: MIT
/**
 * Stepped execution. The layout's stages are generators that yield a `LayoutProgress` between
 * stages and every `ROUTE_STEP` edges of a routing pass, so a host can pause there: the layout worker lets
 * newer requests in and drops a superseded layout at the next step. The synchronous entry points drive the
 * same generators to completion with {@link drain}, so both paths run exactly the same code.
 */

/**
 * Edges routed between two steps of a routing pass: about 10 ms of routing on average on an Apple M1, at most
 * about 30 ms (the longest edges, routed last, of the demo L overview at detail `all`).
 */
export const ROUTE_STEP = 128;

/** Runs a stepped computation to completion and returns its result, ignoring the steps. */
export function drain<T>(steps: Generator<unknown, T, undefined>): T {
  for (;;) {
    const next = steps.next();
    if (next.done === true) return next.value;
  }
}
