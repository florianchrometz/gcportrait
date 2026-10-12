// SPDX-License-Identifier: MIT
/**
 * One answer of the data worker for the drawer, asked whenever its key changes: a newer key aborts the older request,
 * and the last few answers are kept by key, so going back and forth between nodes (or days) is instant. An error is
 * shown, not kept: the key asks again the next time it comes back. The details (useNodeDetails) and "What changed"
 * (useNodeChanges) are asked this way; neither ever asks for a Scene or a layout.
 */
import { useEffect, useRef, useState } from 'react';

import { isDataCancelled, type DataClient } from '../diagram/pipeline/dataClient';
import { useDiagramSession } from '../diagram/session';

/** How many answers are kept (per key). */
const KEPT = 24;

export type AnswerState<T> =
  | { readonly status: 'none' }
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'error'; readonly message: string };

const NONE = { status: 'none' } as const;
const LOADING = { status: 'loading' } as const;

/**
 * The answer for `key` (null: nothing to ask); `ask` puts the question to the data worker's client. The key must
 * name everything the question depends on: `ask` is read only when the key changes.
 */
export function useWorkerAnswer<T>(
  key: string | null,
  ask: (client: DataClient, signal: AbortSignal) => Promise<T>,
): AnswerState<T> {
  const { workers } = useDiagramSession();
  const kept = useRef(new Map<string, AnswerState<T>>());
  const asked = useRef(ask);
  asked.current = ask;
  const [answer, setAnswer] = useState<{ readonly key: string; readonly state: AnswerState<T> } | null>(null);

  useEffect(() => {
    if (key === null || kept.current.has(key)) return undefined;
    const client = workers()?.data;
    if (client === undefined) return undefined;
    const controller = new AbortController();
    asked.current(client, controller.signal).then(
      (value) => {
        const state: AnswerState<T> = { status: 'ready', value };
        kept.current.delete(key);
        kept.current.set(key, state);
        while (kept.current.size > KEPT) {
          const oldest = kept.current.keys().next().value;
          if (oldest === undefined) break;
          kept.current.delete(oldest);
        }
        setAnswer({ key, state });
      },
      (error: unknown) => {
        if (isDataCancelled(error)) return;
        setAnswer({
          key,
          state: { status: 'error', message: error instanceof Error ? error.message : String(error) },
        });
      },
    );
    return () => {
      controller.abort();
    };
  }, [key, workers]);

  if (key === null) return NONE;
  if (answer?.key === key) return answer.state;
  return kept.current.get(key) ?? (workers() === null ? NONE : LOADING);
}
