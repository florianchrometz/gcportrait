// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Playback's state machine (playback.ts): play, stop with a reason, a new interval while playing; where it starts;
 * each timer tick waits for the day on screen, moves to the next available day, and stops at the last one, on a
 * failed drawing or without a position; reduced motion lengthens the interval.
 */
import { describe, expect, it } from 'vitest';

import {
  effectiveInterval,
  nextAvailable,
  playbackReducer,
  playbackStart,
  playbackStep,
  STOPPED,
  type PlaybackFacts,
} from './playback';

describe('playbackReducer', () => {
  it('plays, keeps playing at a new interval, and stops with a reason', () => {
    const playing = playbackReducer(STOPPED, { type: 'play', interval: 1000 });
    expect(playing).toEqual({ status: 'playing', interval: 1000 });
    expect(playbackReducer(playing, { type: 'play', interval: 1000 })).toBe(playing);
    expect(playbackReducer(playing, { type: 'interval', interval: 500 })).toEqual({
      status: 'playing',
      interval: 500,
    });
    expect(playbackReducer(STOPPED, { type: 'interval', interval: 500 })).toBe(STOPPED);
    const stopped = playbackReducer(playing, { type: 'stop', reason: 'interaction' });
    expect(stopped).toEqual({ status: 'stopped', reason: 'interaction' });
    expect(playbackReducer(stopped, { type: 'stop', reason: 'interaction' })).toBe(stopped);
    expect(playbackReducer(stopped, { type: 'stop', reason: 'end' })).toEqual({
      status: 'stopped',
      reason: 'end',
    });
  });
});

describe('effectiveInterval', () => {
  it('is the chosen interval, but never shorter than two seconds with reduced motion', () => {
    expect(effectiveInterval(500, false)).toBe(500);
    expect(effectiveInterval(500, true)).toBe(2000);
    expect(effectiveInterval(4000, true)).toBe(4000);
  });
});

const ALL = Array.from({ length: 5 }, () => true);
const SOME = [true, false, true, false, true];

describe('where playback starts and goes next', () => {
  it('moves to the next available day, skipping the others', () => {
    expect(nextAvailable(SOME, 0)).toBe(2);
    expect(nextAvailable(SOME, 2)).toBe(4);
    expect(nextAvailable(SOME, 4)).toBeNull();
    expect(nextAvailable(SOME, -1)).toBe(0);
  });

  it('starts at the view’s day, or from the first available day when there is nothing after it', () => {
    expect(playbackStart(ALL, 2)).toBe(2);
    expect(playbackStart(ALL, 4)).toBe(0);
    expect(playbackStart(SOME, 4)).toBe(0);
    expect(playbackStart(SOME, 1)).toBe(0);
    expect(playbackStart(SOME, null)).toBe(0);
  });

  it('cannot start with fewer than two available days', () => {
    expect(playbackStart([false, true, false], 1)).toBeNull();
    expect(playbackStart([false, false], null)).toBeNull();
  });
});

describe('playbackStep', () => {
  const facts = (overrides: Partial<PlaybackFacts>): PlaybackFacts => ({
    position: 1,
    drawn: 1,
    pending: false,
    failed: false,
    available: ALL,
    ...overrides,
  });

  it('advances from the day on screen to the next available day', () => {
    expect(playbackStep(facts({}))).toEqual({ type: 'advance', index: 2 });
    expect(playbackStep(facts({ position: 0, drawn: 0, available: SOME }))).toEqual({
      type: 'advance',
      index: 2,
    });
  });

  it('waits while the day it moved to is not drawn yet', () => {
    expect(playbackStep(facts({ drawn: 0 }))).toEqual({ type: 'wait' });
    expect(playbackStep(facts({ pending: true }))).toEqual({ type: 'wait' });
  });

  it('stops at the last available day, on a failed drawing, and without a position', () => {
    expect(playbackStep(facts({ position: 4, drawn: 4 }))).toEqual({ type: 'stop', reason: 'end' });
    expect(
      playbackStep(facts({ position: 2, drawn: 2, available: [true, true, true, false, false] })),
    ).toEqual({
      type: 'stop',
      reason: 'end',
    });
    expect(playbackStep(facts({ failed: true }))).toEqual({ type: 'stop', reason: 'error' });
    expect(playbackStep(facts({ position: null }))).toEqual({ type: 'stop', reason: 'unavailable' });
  });
});
