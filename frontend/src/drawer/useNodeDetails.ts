// SPDX-License-Identifier: Apache-2.0
/**
 * The selected node's details, asked of the data worker (its `details` request, protocol.ts) whenever the
 * selection, the snapshot or the day drawn changes: a lookup in the Graph the worker keeps for the day the request
 * names, the day on screen, never a Scene or a layout. Kept per snapshot, day and node
 * (useWorkerAnswer.ts), so a day's details never stand for another day's.
 */
import type { SnapshotRef } from '@gcportrait/model';

import type { NodeDetails } from './types';
import { useWorkerAnswer, type AnswerState } from './useWorkerAnswer';

export type DetailsState = AnswerState<NodeDetails | null>;

/** `day`: the timeline day drawn (absent: the snapshot's own day). */
export function useNodeDetails(
  snapshot: SnapshotRef,
  day: string | null | undefined,
  id: string | null,
): DetailsState {
  const key = id === null || snapshot === '' ? null : `${snapshot}\u0000${day ?? ''}\u0000${id}`;
  return useWorkerAnswer(key, (client, signal) =>
    id === null ? Promise.resolve(null) : client.details(snapshot, id, { tick: day ?? null }, { signal }),
  );
}
