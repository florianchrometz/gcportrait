// SPDX-License-Identifier: MIT
/**
 * Playback in the timeline bar (playback.ts holds the rules): the play button starts it (from the first available
 * day when the view is on the last one), each step waits for the day's diagram and then the interval, moving the
 * view's `tick` in place (history `replace`: one Back undoes the whole run, not each day), and it stops at the last
 * available day, on any press, key or wheel turn (but a press of the play button, or Enter or Space on it, which
 * toggle it), when a step cannot be drawn, or when the snapshot changes (the store resets the slice). With reduced
 * motion the interval is at least two seconds.
 */
import { useCallback, useEffect, useRef, type RefObject } from 'react';

import { useAppState, useAppStore, useDiagramActions } from '../state';
import { dayAt, withTick, type TimelineModel } from './model';
import {
  effectiveInterval,
  playbackReducer,
  playbackStart,
  playbackStep,
  type PlaybackEvent,
  type PlaybackInterval,
} from './playback';

export interface PlaybackControls {
  readonly playing: boolean;
  /** Why playback cannot start (fewer than two days available), or null. */
  readonly unavailable: string | null;
  readonly toggle: () => void;
  readonly setInterval: (interval: PlaybackInterval) => void;
  /** The play button: a press on it, or Enter or Space, is the toggle, not an interaction that stops playback. */
  readonly buttonRef: RefObject<HTMLButtonElement | null>;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** The events that stop playback when they happen anywhere but on the play button. */
const INTERACTIONS = ['pointerdown', 'keydown', 'wheel'] as const;

export function usePlayback(model: TimelineModel | null): PlaybackControls {
  const store = useAppStore();
  const actions = useDiagramActions();
  const playback = useAppState((state) => state.timeline.playback);
  const interval = useAppState((state) => state.timeline.interval);
  const pending = useAppState((state) => state.pipeline.pending !== null);
  const failed = useAppState((state) => state.pipeline.error !== null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const playing = playback.status === 'playing';

  const dispatch = useCallback(
    (event: PlaybackEvent): void => {
      store.updateTimeline((current) => {
        const next = playbackReducer(current.playback, event);
        const chosen = event.type === 'stop' ? current.interval : event.interval;
        return next === current.playback && chosen === current.interval
          ? current
          : { ...current, playback: next, interval: chosen };
      });
    },
    [store],
  );

  useEffect(() => {
    if (!playing) return undefined;
    const stop = (event: Event): void => {
      const button = buttonRef.current;
      const onButton = button !== null && event.target instanceof Node && button.contains(event.target);
      // A press on the play button, or the keys that press it, toggle it themselves; any other key there stops.
      const toggles = event instanceof KeyboardEvent ? event.key === 'Enter' || event.key === ' ' : true;
      if (onButton && toggles) return;
      dispatch({ type: 'stop', reason: 'interaction' });
    };
    for (const type of INTERACTIONS) document.addEventListener(type, stop, { capture: true, passive: true });
    return () => {
      for (const type of INTERACTIONS) document.removeEventListener(type, stop, { capture: true });
    };
  }, [playing, dispatch]);

  const position = model?.position ?? null;
  const drawn = model?.drawn ?? null;
  const available = model?.available ?? null;
  const availableKey = available?.map((ok) => (ok ? '1' : '0')).join('') ?? '';

  useEffect(() => {
    if (!playing || model === null || available === null) return undefined;
    const decision = playbackStep({ position, drawn, pending, failed, available });
    if (decision.type === 'stop') {
      dispatch({ type: 'stop', reason: decision.reason });
      return undefined;
    }
    if (decision.type === 'wait') return undefined;
    const day = dayAt(model, decision.index);
    if (day === undefined) return undefined;
    const timer = setTimeout(
      () => {
        actions.setView((spec) => withTick(spec, day), { history: 'replace' });
      },
      effectiveInterval(interval, prefersReducedMotion()),
    );
    return () => {
      clearTimeout(timer);
    };
    // `availableKey` stands for `available`, and the model's ticks stay the same for a snapshot: a new model with the
    // same content (a read's progress elsewhere on the timeline) must not restart the interval.
  }, [playing, position, drawn, pending, failed, availableKey, interval, actions, dispatch]);

  const start = model === null ? null : playbackStart(model.available, model.position);
  const unavailable =
    start === null
      ? 'Playback needs at least two days that can be shown without reading Google Cloud.'
      : null;

  const toggle = useCallback((): void => {
    if (playing) {
      dispatch({ type: 'stop', reason: 'user' });
      return;
    }
    if (model === null || start === null) return;
    if (start !== model.position) {
      const day = dayAt(model, start);
      if (day !== undefined) actions.setView((spec) => withTick(spec, day));
    }
    dispatch({ type: 'play', interval });
  }, [playing, model, start, actions, dispatch, interval]);

  const setInterval = useCallback(
    (next: PlaybackInterval): void => {
      if (playing) dispatch({ type: 'interval', interval: next });
      else
        store.updateTimeline((current) =>
          current.interval === next ? current : { ...current, interval: next },
        );
    },
    [playing, dispatch, store],
  );

  return { playing, unavailable, toggle, setInterval, buttonRef };
}
