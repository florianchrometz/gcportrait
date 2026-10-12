// SPDX-License-Identifier: MIT
/**
 * What changed about one node between the day on screen before and the drawn day (the details drawer's
 * "What changed" section), worked out in the data worker, where both days' Graphs and assets are
 * (diagram/pipeline/dataHandler.ts answers `changes` requests with {@link nodeChanges}). Pure.
 *
 * - The node itself: added (only on the drawn day), removed (only on the earlier day: a ghost), changed (another
 *   `updateTime`, compared as an instant, the rule of `diffSnapshots`) or unchanged; its `updateTime` on both
 *   days; for a changed node, the fields of `resource.data` that differ (fieldDiff.ts).
 * - Inside it (a container, at any depth): the nodes added and changed (by the drawn day's containment) and
 *   removed (by the earlier day's), each list by label, capped.
 */
import { compareTimestamps } from '@gcportrait/graph';
import type { Asset, Graph, Snapshot } from '@gcportrait/model';

import { nodeRef } from './details';
import { fieldDiff } from './fieldDiff';
import type { ChangeList, ChangeStatus, NodeChanges, NodeRef } from './types';

/** How many nodes each "inside" list names (the rest are counted). */
export const CHANGES_CAP = 25;

/** One day as the data worker holds it: its snapshot, its assets by name and its Graph. */
export interface ChangesDay {
  readonly snapshot: Snapshot;
  readonly assets: ReadonlyMap<string, Asset>;
  readonly graph: Graph;
  /** Its tick; absent: the snapshot's own day. */
  readonly tick?: string;
}

/** Every node below `id` in a Graph's containment (not `id` itself), each once (cycle-safe). */
function descendants(graph: Graph, id: string): string[] {
  const seen = new Set<string>([id]);
  const out: string[] = [];
  const queue = [...(graph.containment.children[id] ?? [])];
  for (let index = 0; index < queue.length; index += 1) {
    const next = queue[index];
    if (next === undefined || seen.has(next)) continue;
    seen.add(next);
    out.push(next);
    queue.push(...(graph.containment.children[next] ?? []));
  }
  return out;
}

function byLabel(a: NodeRef, b: NodeRef): number {
  return a.label < b.label ? -1 : a.label > b.label ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function capped(refs: NodeRef[], cap: number): ChangeList {
  refs.sort(byLabel);
  return { entries: refs.slice(0, cap), more: Math.max(0, refs.length - cap) };
}

function statusOf(before: Asset | undefined, after: Asset | undefined): ChangeStatus | null {
  if (before === undefined && after === undefined) return null;
  if (before === undefined) return 'added';
  if (after === undefined) return 'removed';
  return compareTimestamps(before.updateTime, after.updateTime) === 0 ? 'unchanged' : 'changed';
}

/**
 * What changed about node `id` from day `before` to day `after`; null when neither day has it (a zone the scene
 * builder adds, a region or a bundle, is no asset).
 */
export function nodeChanges(
  before: ChangesDay,
  after: ChangesDay,
  id: string,
  cap: number = CHANGES_CAP,
): NodeChanges | null {
  const then = before.assets.get(id);
  const now = after.assets.get(id);
  const status = statusOf(then, now);
  const inGraph = Object.hasOwn(after.graph.nodes, id) || Object.hasOwn(before.graph.nodes, id);
  if (status === null && !inGraph) return null;
  const ref = Object.hasOwn(after.graph.nodes, id) ? nodeRef(after.graph, id) : nodeRef(before.graph, id);
  const added: NodeRef[] = [];
  const changed: NodeRef[] = [];
  const removed: NodeRef[] = [];
  if (Object.hasOwn(after.graph.nodes, id)) {
    for (const child of descendants(after.graph, id)) {
      const old = before.assets.get(child);
      const current = after.assets.get(child);
      if (current === undefined) continue;
      if (old === undefined) added.push(nodeRef(after.graph, child));
      else if (compareTimestamps(old.updateTime, current.updateTime) !== 0)
        changed.push(nodeRef(after.graph, child));
    }
  }
  if (Object.hasOwn(before.graph.nodes, id)) {
    for (const child of descendants(before.graph, id)) {
      if (before.assets.has(child) && !after.assets.has(child)) removed.push(nodeRef(before.graph, child));
    }
  }
  return {
    since: {
      ...(before.tick === undefined ? {} : { tick: before.tick }),
      readTime: before.snapshot.readTime,
    },
    readTime: after.snapshot.readTime,
    status: status ?? 'unchanged',
    label: ref.label,
    typeName: ref.typeName,
    updateTime: {
      ...(then === undefined ? {} : { before: then.updateTime }),
      ...(now === undefined ? {} : { after: now.updateTime }),
    },
    ...(status === 'changed' ? { fields: fieldDiff(then?.data, now?.data) } : {}),
    inside: { added: capped(added, cap), removed: capped(removed, cap), changed: capped(changed, cap) },
  };
}
