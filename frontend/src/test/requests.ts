// SPDX-License-Identifier: Apache-2.0
/**
 * The requests a test counts, each with whether the app called it off. The unit tests mount under StrictMode
 * (src/test/setup.ts), as development does: on mount every effect runs, cleans up and runs again, so a request an
 * effect makes is made twice and the first is called off by the clean-up (its signal aborted before its answer). A
 * build makes it once. A test counts the requests the app kept: an effect whose clean-up leaves its request running
 * keeps two, and the count fails. Imported by tests only.
 */

/** What a request's signal offers here: an `AbortSignal`, or the layout client's structural one. */
export interface RequestSignal {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void;
}

/**
 * Watches a request made with `signal` and answered by `answer`: the function returned says whether the signal was
 * aborted before the answer settled (a request never answered is called off once its signal is aborted).
 */
export function watchRequest(
  signal: RequestSignal | null | undefined,
  answer: Promise<unknown>,
): () => boolean {
  let settled = false;
  let calledOff = signal?.aborted === true;
  const settle = (): void => {
    settled = true;
  };
  void answer.then(settle, settle);
  signal?.addEventListener(
    'abort',
    () => {
      if (!settled) calledOff = true;
    },
    { once: true },
  );
  return () => calledOff;
}

export interface RequestLog<T> {
  /** Records `value` for a request made with `signal` and answered by `answer`; returns `answer`. */
  record<A>(value: T, signal: RequestSignal | null | undefined, answer: Promise<A>): Promise<A>;
  /** The values of the requests the app kept (none called off), in order. */
  readonly kept: () => T[];
  /** The values of every request, in order. */
  readonly all: () => T[];
}

/** A log of requests, for a stand-in that counts what the app asks of it. */
export function requestLog<T>(): RequestLog<T> {
  const entries: Array<{ readonly value: T; readonly calledOff: () => boolean }> = [];
  return {
    record(value, signal, answer) {
      entries.push({ value, calledOff: watchRequest(signal, answer) });
      return answer;
    },
    kept: () => entries.filter((entry) => !entry.calledOff()).map((entry) => entry.value),
    all: () => entries.map((entry) => entry.value),
  };
}
