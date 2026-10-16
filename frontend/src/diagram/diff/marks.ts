// SPDX-License-Identifier: MIT
/**
 * The timeline markers of a drawn day (skill gcp-diagram-style §6): which rects get which
 * marker, and where each goes. Pure: the layout and the day's diff (what the data worker sent with the Scene) in,
 * ids and geometry out; the drawing (Drawing.tsx) draws them, so the interactive canvas, the baselines and the
 * export show the same markers.
 *
 * - **Added**: the `accent.peer` outline around each added node drawn as itself, the outermost of an added subtree
 *   only (a new project's contents are new with it).
 * - **Changed**: the `accent.path` dot on the top-right corner of each changed node drawn as itself, and of each
 *   chip that holds something the view would draw that changed, was added or was removed (it says what in its
 *   name).
 * - **Removed**: the ghosts the data worker put into the Scene, drawn where the layout placed them (their old
 *   place among their siblings); never interactive. A ghost of a zone the earlier day drew as the view's overlay (a
 *   perimeter drawn around its projects; the diff's `earlier`) is drawn as an overlay, untinted with its dashes.
 *
 * The markers last as long as the day does: the next day is compared with this one.
 */
import type { Layout, LayoutRect, Rect } from '@gcportrait/layout';

import { ringBox, roundedRectPath } from '../geometry/rings';
import { nodeRadius } from '../marks';
import { ADDED_DISTANCE } from '../theme/styles';
import type { DiffCounts, DiffDay, GhostReason, TickDiff } from './types';
import { comparesForward } from './words';

export interface DiffMarks {
  /** The day compared with. */
  readonly since: DiffDay;
  /** Whether that day is earlier than the drawn one (stepping forward, playback): "since", else "compared with". */
  readonly forward: boolean;
  /** Rects with the added outline, in paint order. */
  readonly added: readonly string[];
  /** Rects with the changed dot, in paint order (changed nodes, and chips with changes inside). */
  readonly changed: readonly string[];
  /** Ghost rects and why each is one, in paint order. */
  readonly ghosts: ReadonlyMap<string, GhostReason>;
  /** The ghosts of zones the earlier day drew as the view's overlay, drawn as overlays, in paint order. */
  readonly overlays: readonly string[];
  /** Drawn nodes that were added or changed themselves (an added subtree's every node): their names say so. */
  readonly status: ReadonlyMap<string, 'added' | 'changed'>;
  /** Chips' counts of what changed inside them. */
  readonly inside: ReadonlyMap<string, DiffCounts>;
  /** The whole diff's counts (the drawing's description). */
  readonly totals: DiffCounts;
}

/**
 * The markers of a layout drawn for a day with its diff; null without a diff (no day compared with: a link opened,
 * the snapshot's first diagram). `readTime` is the drawn day's.
 */
export function diffMarks(diff: TickDiff | undefined, layout: Layout, readTime: string): DiffMarks | null {
  if (diff === undefined) return null;
  const added = new Set(diff.added);
  const changed = new Set(diff.changed);
  const ghosts = new Map<string, GhostReason>();
  const overlays: string[] = [];
  const outlined: string[] = [];
  const dotted: string[] = [];
  const status = new Map<string, 'added' | 'changed'>();
  const inside = new Map<string, DiffCounts>();
  for (const [id, rect] of Object.entries(layout.rects)) {
    const ghost = Object.hasOwn(diff.ghosts, id) ? diff.ghosts[id] : undefined;
    if (ghost !== undefined) {
      ghosts.set(id, ghost);
      if (Object.hasOwn(diff.earlier, id) && diff.earlier[id]?.overlay === true) overlays.push(id);
      continue;
    }
    if (added.has(id)) {
      status.set(id, 'added');
      if (rect.parent === null || !added.has(rect.parent)) outlined.push(id);
      continue;
    }
    const held = Object.hasOwn(diff.inside, id) && rect.role === 'chip' ? diff.inside[id] : undefined;
    if (held !== undefined) inside.set(id, held);
    if (changed.has(id)) status.set(id, 'changed');
    if (changed.has(id) || held !== undefined) dotted.push(id);
  }
  return {
    since: diff.since,
    forward: comparesForward(diff.since, readTime),
    added: outlined,
    changed: dotted,
    ghosts,
    overlays,
    status,
    inside,
    totals: { added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length },
  };
}

/** The added outlines of the given rects as one path (the canvas gaps and the line each draw it once). */
export function addedPathData(rects: ReadonlyArray<Rect & Pick<LayoutRect, 'role'>>): string {
  return rects
    .map((rect) => roundedRectPath(ringBox(rect, ADDED_DISTANCE), nodeRadius(rect) + ADDED_DISTANCE))
    .join('');
}

/** Where the changed dot is centred: on the middle of the node's rounded top-right corner. */
export function changedDotCentre(rect: Rect & Pick<LayoutRect, 'role'>): {
  readonly x: number;
  readonly y: number;
} {
  const radius = Math.min(nodeRadius(rect), rect.width / 2, rect.height / 2);
  const inset = radius - radius / Math.SQRT2;
  return { x: rect.x + rect.width - inset, y: rect.y + inset };
}
