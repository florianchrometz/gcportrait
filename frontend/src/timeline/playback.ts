// SPDX-License-Identifier: Apache-2.0
/**
 * Playback (the Play button animates through cached ticks; docs/timeline.md): from the tick on screen to each later
 * tick that is available without reading Google Cloud (every day of a stored history; a live scope's cached ticks
 * and the snapshot's own day), one step per interval, waiting for each step's diagram before counting the next
 * interval, and stopping at the last one. Any interaction stops it (timeline/usePlayback.ts listens for presses,
 * keys and wheel turns); so does a snapshot change, or a step that cannot be drawn. With reduced motion the steps
 * are at least {@link REDUCED_MOTION_INTERVAL} apart and the bar's thumb jumps instead of gliding.
 *
 * Pure: the state, the reducer and the decision for each timer tick. The hook owns the timer.
 */

/** The intervals the person can choose between, in milliseconds per tick. */
export const PLAYBACK_INTERVALS = [500, 1000, 2000] as const;
export type PlaybackInterval = (typeof PLAYBACK_INTERVALS)[number];

/** The interval playback starts with. */
export const DEFAULT_PLAYBACK_INTERVAL: PlaybackInterval = 1000;

/** The shortest interval with reduced motion (prefers-reduced-motion: reduce). */
export const REDUCED_MOTION_INTERVAL = 2000;

/** Why playback is not running. */
export type StopReason = 'user' | 'interaction' | 'end' | 'error' | 'snapshot' | 'unavailable';

export type PlaybackState =
  | { readonly status: 'stopped'; readonly reason?: StopReason }
  | { readonly status: 'playing'; readonly interval: PlaybackInterval };

export const STOPPED: PlaybackState = { status: 'stopped' };

export type PlaybackEvent =
  | { readonly type: 'play'; readonly interval: PlaybackInterval }
  | { readonly type: 'stop'; readonly reason: StopReason }
  /** The person chose another interval: kept while playing. */
  | { readonly type: 'interval'; readonly interval: PlaybackInterval };

export function playbackReducer(state: PlaybackState, event: PlaybackEvent): PlaybackState {
  switch (event.type) {
    case 'play':
      return state.status === 'playing' && state.interval === event.interval
        ? state
        : { status: 'playing', interval: event.interval };
    case 'stop':
      return state.status === 'stopped' && state.reason === event.reason
        ? state
        : { status: 'stopped', reason: event.reason };
    case 'interval':
      return state.status === 'playing' && state.interval !== event.interval
        ? { status: 'playing', interval: event.interval }
        : state;
  }
}

/** The interval to wait: the chosen one, never shorter than {@link REDUCED_MOTION_INTERVAL} with reduced motion. */
export function effectiveInterval(interval: number, reducedMotion: boolean): number {
  return reducedMotion ? Math.max(interval, REDUCED_MOTION_INTERVAL) : interval;
}

/** The first available tick after `position`, or null. */
export function nextAvailable(available: readonly boolean[], position: number): number | null {
  for (let index = Math.max(0, position + 1); index < available.length; index += 1)
    if (available[index] === true) return index;
  return null;
}

/**
 * Where playback starts: at the position, or, from the last available tick (or from a position before every
 * available one), at the first available tick. Null when fewer than two ticks are available: nothing to play.
 */
export function playbackStart(available: readonly boolean[], position: number | null): number | null {
  const indexes = available.flatMap((ok, index) => (ok ? [index] : []));
  const first = indexes[0];
  if (first === undefined || indexes.length < 2) return null;
  if (position === null || available[position] !== true) return first;
  return nextAvailable(available, position) === null ? first : position;
}

/** What playback does when its interval has passed. */
export type PlaybackStep =
  /** The tick it moved to is not drawn yet: wait for it before counting the next interval. */
  | { readonly type: 'wait' }
  | { readonly type: 'advance'; readonly index: number }
  | { readonly type: 'stop'; readonly reason: StopReason };

export interface PlaybackFacts {
  /** The tick the view is at (the hash's), or null. */
  readonly position: number | null;
  /** The tick on screen, or null. */
  readonly drawn: number | null;
  /** The pipeline is preparing a diagram. */
  readonly pending: boolean;
  /** The diagram could not be drawn. */
  readonly failed: boolean;
  /** Per tick, whether it is available without reading Google Cloud. */
  readonly available: readonly boolean[];
}

/** The decision for one timer tick while playing (pure; the hook acts on it). */
export function playbackStep(facts: PlaybackFacts): PlaybackStep {
  if (facts.failed) return { type: 'stop', reason: 'error' };
  if (facts.position === null) return { type: 'stop', reason: 'unavailable' };
  if (facts.pending || facts.drawn !== facts.position) return { type: 'wait' };
  const next = nextAvailable(facts.available, facts.position);
  return next === null ? { type: 'stop', reason: 'end' } : { type: 'advance', index: next };
}
