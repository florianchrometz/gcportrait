// SPDX-License-Identifier: MIT
/**
 * What changed about the selected node between the day compared with and the day drawn (the drawer's "What
 * changed" section), asked of the data worker (its `changes` request, drawer/changes.ts) only while the diagram on
 * screen carries a diff; kept per snapshot, both days and node (useWorkerAnswer.ts).
 */
import type { SnapshotRef } from '@gcportrait/model';

import type { DiffFrom } from '../diagram/diff/types';
import type { NodeChanges } from './types';
import { useWorkerAnswer, type AnswerState } from './useWorkerAnswer';

export type ChangesState = AnswerState<NodeChanges | null>;

/** `days`: the day compared with and the day drawn (each a tick, or null for the snapshot's own day); null: none. */
export function useNodeChanges(
  snapshot: SnapshotRef,
  days: { readonly since: DiffFrom; readonly day: DiffFrom } | null,
  id: string | null,
): ChangesState {
  const key =
    id === null || snapshot === '' || days === null
      ? null
      : `${snapshot}\u0000${days.since.tick ?? ''}\u0000${days.day.tick ?? ''}\u0000${id}`;
  return useWorkerAnswer(key, (client, signal) =>
    id === null || days === null ? Promise.resolve(null) : client.changes(snapshot, id, days, { signal }),
  );
}
