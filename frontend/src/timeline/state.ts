// SPDX-License-Identifier: Apache-2.0
/**
 * The app store's `timeline` slice (state/slices.ts): what the timeline knows about the open snapshot
 * besides the view's `tick`, which lives in the URL hash like the rest of the view. Plain data: the store resets it
 * when the snapshot changes, the timeline controller (controller.ts) fills it, the bar (pages/diagram/TimelineBar.tsx)
 * and the timeline keys read it. Never in the hash.
 */
import type { SnapshotRef } from '@gcportrait/model';

import type { ImportFailure, ImportProgress } from '../import/progress';
import type { ExtraTick } from './extraTicks';
import { DEFAULT_PLAYBACK_INTERVAL, STOPPED, type PlaybackInterval, type PlaybackState } from './playback';
import type { TimelineInfo } from './types';

/** A live scope's tick that is not unknown: being read, read and cached, or failed. */
export type TickStatus = 'loading' | 'cached' | 'error';

export interface TimelineSlice {
  /** The snapshot this describes (the view's; `''` when none). */
  readonly ref: SnapshotRef;
  /** The snapshot's timeline as the data worker reported it with its first Scene; null until then. */
  readonly info: TimelineInfo | null;
  /** The timeline's last day: the history's last day, or for a live scope the app's UTC day when it was set up. */
  readonly today: string | null;
  /** A live scope's "now" when the timeline was set up: the latest tick's instant (its label's local date). */
  readonly now: number | null;
  /** A live scope's ticks that are being read, cached or failed, by day (every other day is unknown). */
  readonly status: Readonly<Record<string, TickStatus>>;
  /** Why a live day could not be read, by day (Google's message verbatim, a title and advice: import/errors.ts). */
  readonly failures: Readonly<Record<string, ImportFailure>>;
  /** The read in progress the bar reports (the view's day when it is being read, else the first one running). */
  readonly progress: { readonly day: string; readonly progress: ImportProgress } | null;
  /** Why a live scope's days cannot be read from Google Cloud now (null: they can, or there is nothing to read). */
  readonly blocked: string | null;
  readonly playback: PlaybackState;
  /** The playback interval the person chose (kept for the page's life, across snapshots). */
  readonly interval: PlaybackInterval;
  /**
   * The extra ticks (extraTicks.ts): the exports and manual pulls of the snapshot's scope stored in this
   * browser, written by the snapshot library's binding (snapshots/SnapshotLibraryProvider.tsx) once `info` is known
   * and the stored snapshots are listed; null until then (a link naming an extra tick waits for them, rather than
   * drawing the snapshot itself meanwhile).
   */
  readonly extras: readonly ExtraTick[] | null;
  /** Whether playback goes through the extra ticks too (off unless the person turns it on; kept like `interval`). */
  readonly playExtras: boolean;
}

/** The slice for snapshot `ref` before anything is known about its timeline. */
export function initialTimeline(
  ref: SnapshotRef,
  interval: PlaybackInterval = DEFAULT_PLAYBACK_INTERVAL,
  playExtras = false,
): TimelineSlice {
  return {
    ref,
    info: null,
    today: null,
    now: null,
    status: {},
    failures: {},
    progress: null,
    blocked: null,
    playback: STOPPED,
    interval,
    extras: null,
    playExtras,
  };
}
