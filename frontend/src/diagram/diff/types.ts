// SPDX-License-Identifier: MIT
/**
 * The timeline diff overlay's data (docs/timeline.md; style skill §6), as it crosses `postMessage`: what the page
 * asks the data worker to compare the day it draws with (`DiffFrom`, with a Scene request), and what the worker
 * answers with that day's Scene (`TickDiff`). Types only, so the UI thread imports nothing of the worker's side
 * through this module.
 */
import type { ZoneKind } from '@gcportrait/model';

/** The day to compare the drawn day with: a timeline tick, or (`null`) the snapshot's own day. */
export interface DiffFrom {
  readonly tick: string | null;
}

/** A day the diff compared with: its tick (absent: the snapshot's own day) and the read time of its data. */
export interface DiffDay {
  readonly tick?: string;
  readonly readTime: string;
  /**
   * The label of an extra tick ("export 2026-10-05 14:30"), which the diff wording uses instead of the date, so it is
   * told from the day itself; the page adds it from the timeline's extra ticks (timeline/extraTicks.ts
   * `extraDayLabel`), the worker never does.
   */
  readonly label?: string;
}

export interface DiffCounts {
  readonly added: number;
  readonly removed: number;
  readonly changed: number;
}

/**
 * Why a node is drawn as a ghost: it was `removed` (absent from the drawn day), or it is `hidden`: it changed so
 * that the view no longer draws it where it stood, like a project marked for deletion (one the drawn day holds in
 * another container, or inside a chip, is no ghost: it is drawn there, or the chip counts it). Inside a ghost only
 * what was removed comes back, and the zones that are no asset around it (a region of a removed project) take the
 * reason of the ghost around them; an asset still there on the drawn day is never a ghost inside another.
 */
export type GhostReason = 'removed' | 'hidden';

/**
 * A zone of the earlier day's view (built at the detail level the drawn Scene uses, with the view's flips) that the
 * ghosts depend on, as that day drew it: what the scene builder decided its state from there and the state it gave
 * it. These can differ from the drawn day's (a zone moved, a perimeter removed), so the disclosure buttons judge
 * a press's ghosts by them (disclosure/flips.ts).
 */
export interface EarlierZone {
  readonly kind: ZoneKind;
  /** The zone it lay in (null: the canvas). */
  readonly parent: string | null;
  /**
   * The view's overlay zone there (a perimeter drawn around its projects): open at every level, and its ghost is
   * drawn as an overlay (diff/marks.ts).
   */
  readonly overlay: boolean;
  /** Drawn as a chip. */
  readonly collapsed: boolean;
  /** Open with nothing inside: never a chip, and the scene builder ignored its flip. */
  readonly empty: boolean;
}

/**
 * The drawn day compared with the previously displayed one (`diffSnapshots` of `@gcportrait/graph`, by asset
 * name: `added` are in the drawn day only, `removed` in the earlier one only, `changed` in both with another
 * `updateTime`), and what the Scene carries for it.
 */
export interface TickDiff {
  /** The day compared with: the one on screen before this one. */
  readonly since: DiffDay;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
  /**
   * The ghosts the data worker put into the Scene, by node id: the nodes the view drew on the earlier day and no
   * longer draws, removed or left out where they stood (`GhostReason`), each in its old container, so the layout
   * places it where it was (a ghost card for one tick).
   */
  readonly ghosts: Readonly<Record<string, GhostReason>>;
  /**
   * The zones the ghosts depend on, by node id, as the earlier day drew them: every ghost zone, and every zone
   * around a ghost there (those all the way up to the canvas, each open).
   */
  readonly earlier: Readonly<Record<string, EarlierZone>>;
  /**
   * The collapsed zones (chips) of the Scene that hold something the view would draw that was added, removed or
   * changed, with how many of each.
   */
  readonly inside: Readonly<Record<string, DiffCounts>>;
}
