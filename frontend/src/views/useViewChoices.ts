// SPDX-License-Identifier: Apache-2.0
/**
 * The view choices (choices.ts) of the snapshot on screen, on the day on screen, for the top bar's controls. They
 * are asked from the data worker once per snapshot, day and data client (a small cache every control shares), and
 * only once the snapshot is loaded (`snapshot.status === 'ready'` for the view's snapshot), so asking never makes
 * the worker load a snapshot the view has already left. The request names the day drawn, so the Focus and
 * Filters pickers offer the projects and regions of the day on screen, not those of the first day drawn. Null until
 * they arrive, away from the diagram, and without workers; `useViewChoicesState` also says why they cannot arrive
 * (the snapshot failed to load, or the request did).
 */
import type { SnapshotRef } from '@gcportrait/model';
import { useEffect, useState } from 'react';

import type { DataClient } from '../diagram/pipeline/dataClient';
import { useDiagramSession } from '../diagram/session';
import { selectDrawnDay, selectLoadedSnapshot, useAppState, type AppState } from '../state';
import type { ViewChoices } from './choices';

/** Snapshot days whose choices are kept per data client (the oldest asked goes first). */
const KEEP = 6;
const CACHE = new WeakMap<DataClient, Map<string, Promise<ViewChoices>>>();

/**
 * The choices of a snapshot on a day (a tick, or null for its own day), asked once per data client and kept; a
 * failed request is forgotten.
 */
export function choicesFor(
  client: DataClient,
  ref: SnapshotRef,
  day: string | null = null,
): Promise<ViewChoices> {
  let byRef = CACHE.get(client);
  if (byRef === undefined) {
    byRef = new Map();
    CACHE.set(client, byRef);
  }
  const key = `${ref}\u0000${day ?? ''}`;
  const known = byRef.get(key);
  if (known !== undefined) return known;
  const asked = client.choices(ref, { tick: day });
  const kept = byRef;
  kept.set(key, asked);
  asked.catch(() => {
    if (kept.get(key) === asked) kept.delete(key);
  });
  for (const oldest of kept.keys()) {
    if (kept.size <= KEEP) break;
    kept.delete(oldest);
  }
  return asked;
}

export { selectLoadedSnapshot } from '../state';

/** The view choices, or why there are none (the snapshot could not be loaded, or its choices not read). */
export interface ViewChoicesState {
  /** Null until they arrive, and when they cannot. */
  readonly choices: ViewChoices | null;
  /** Why they cannot arrive, for the person; null while they may still. */
  readonly error: string | null;
}

/** The view's snapshot could not be loaded: why, or null. */
function selectSnapshotError(state: AppState): string | null {
  const { snapshot } = state;
  if (!state.view.onDiagram || snapshot.status !== 'error' || snapshot.ref !== state.view.spec.snapshot)
    return null;
  return snapshot.error ?? 'The snapshot could not be loaded.';
}

/**
 * The view choices with their failure: a picker over them says why there is nothing to pick when the
 * snapshot could not be loaded, or the data worker could not answer, instead of "Loading" for good.
 */
export function useViewChoicesState(): ViewChoicesState {
  const { workers } = useDiagramSession();
  const ref = useAppState(selectLoadedSnapshot);
  // The day on screen; the snapshot's own day while nothing of it is drawn.
  const day = useAppState(selectDrawnDay) ?? null;
  const snapshotError = useAppState(selectSnapshotError);
  const [answer, setAnswer] = useState<{
    readonly ref: SnapshotRef;
    readonly day: string | null;
    readonly choices: ViewChoices | null;
    readonly error: string | null;
  } | null>(null);

  useEffect(() => {
    if (ref === '') return undefined;
    const client = workers()?.data;
    if (client === undefined) return undefined;
    let live = true;
    choicesFor(client, ref, day).then(
      (choices) => {
        if (live) setAnswer({ ref, day, choices, error: null });
      },
      (error: unknown) => {
        if (live)
          setAnswer({
            ref,
            day,
            choices: null,
            error: `The snapshot's choices could not be read: ${error instanceof Error ? error.message : String(error)}`,
          });
      },
    );
    return () => {
      live = false;
    };
  }, [ref, day, workers]);

  if (snapshotError !== null) return { choices: null, error: snapshotError };
  // Another day's choices stay offered until this day's arrive (the pickers do not flash "Loading" on each step).
  return answer !== null && answer.ref === ref
    ? { choices: answer.choices, error: answer.day === day ? answer.error : null }
    : { choices: null, error: null };
}

export function useViewChoices(): ViewChoices | null {
  return useViewChoicesState().choices;
}
