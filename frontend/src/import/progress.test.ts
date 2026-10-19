// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import {
  IDLE_PROGRESS,
  elapsedMs,
  formatElapsed,
  importProgressReducer,
  isRunning,
  progressCounters,
  shareRead,
  stageText,
  type ImportAction,
  type ImportProgress,
} from './progress';

const T0 = Date.parse('2026-10-10T12:00:00Z');

function run(actions: readonly ImportAction[], from: ImportProgress = IDLE_PROGRESS): ImportProgress {
  return actions.reduce(importProgressReducer, from);
}

const FAILURE = { title: 'Google refused the request.', message: 'Denied.' };

describe('the import progress reducer', () => {
  it('runs a pull from start to done: pages, assets, bytes and elapsed time', () => {
    const states: ImportProgress[] = [];
    const actions: ImportAction[] = [
      { type: 'start', kind: 'pull', at: T0 },
      { type: 'connected', at: T0 + 300 },
      { type: 'received', bytes: 400_000, at: T0 + 500 },
      { type: 'counted', pages: 1, assets: 500, at: T0 + 600 },
      { type: 'tick', at: T0 + 1000 },
      { type: 'received', bytes: 1_250_000, at: T0 + 1800 },
      { type: 'counted', pages: 3, assets: 1120, at: T0 + 1900 },
      { type: 'storing', at: T0 + 2000 },
      {
        type: 'done',
        result: { ref: '01J9Z3K5Q8XW2V4N6P7R8S9T0A', assets: 1120, readTime: '2026-10-10T11:59:59Z' },
        at: T0 + 2400,
      },
    ];
    let state = IDLE_PROGRESS;
    for (const action of actions) {
      state = importProgressReducer(state, action);
      states.push(state);
    }
    expect(states.map((entry) => entry.phase)).toEqual([
      'connecting',
      'reading',
      'reading',
      'reading',
      'reading',
      'reading',
      'reading',
      'storing',
      'done',
    ]);
    expect(states[3]).toMatchObject({ pages: 1, assets: 500, bytes: 400_000 });
    expect(progressCounters(states[4] ?? IDLE_PROGRESS)).toBe('1 page · 500 assets · 400 kB · 0:01');
    expect(progressCounters(states[6] ?? IDLE_PROGRESS)).toBe('3 pages · 1,120 assets · 1.3 MB · 0:01');
    expect(state).toMatchObject({
      phase: 'done',
      pages: 3,
      assets: 1120,
      bytes: 1_250_000,
      endedAt: T0 + 2400,
    });
    expect(elapsedMs(state)).toBe(2400);
    expect(isRunning(state)).toBe(false);
    expect(stageText(state)).toBe('Read 1,120 assets in 0:02; opening the diagram.');
  });

  it('never lets a counter go back, and keeps the latest clock', () => {
    const state = run([
      { type: 'start', kind: 'pull', at: T0 },
      { type: 'counted', pages: 4, assets: 2000, at: T0 + 2000 },
      { type: 'counted', pages: 2, assets: 900, at: T0 + 1000 },
      { type: 'received', bytes: 5000, at: T0 + 2100 },
      { type: 'received', bytes: 4000, at: T0 + 2200 },
      { type: 'counted', assets: 2100, at: T0 + 2300 },
    ]);
    expect(state).toMatchObject({ pages: 4, assets: 2100, bytes: 5000, now: T0 + 2300 });
  });

  it('stops the clock when the import ends, whatever ticks follow', () => {
    const failed = run([
      { type: 'start', kind: 'export', at: T0 },
      { type: 'tick', at: T0 + 5000 },
      { type: 'failed', failure: FAILURE, at: T0 + 6500 },
      { type: 'tick', at: T0 + 9000 },
      { type: 'counted', assets: 10, at: T0 + 9500 },
    ]);
    expect(failed).toMatchObject({ phase: 'failed', assets: 0, endedAt: T0 + 6500, failure: FAILURE });
    expect(formatElapsed(elapsedMs(failed))).toBe('0:06');
    expect(stageText(failed)).toBe('');
  });

  it('ignores everything but a new start once cancelled, and a new start begins afresh', () => {
    const cancelled = run([
      { type: 'start', kind: 'pull', at: T0 },
      { type: 'counted', pages: 2, assets: 1000, at: T0 + 100 },
      { type: 'cancelled', at: T0 + 200 },
      { type: 'done', result: { ref: 'x', assets: 1, readTime: 'y' }, at: T0 + 300 },
    ]);
    expect(cancelled).toMatchObject({ phase: 'cancelled', result: null, pages: 2 });
    expect(stageText(cancelled)).toBe('Cancelled. Nothing was stored.');
    const again = importProgressReducer(cancelled, { type: 'start', kind: 'export', at: T0 + 10_000 });
    expect(again).toEqual({
      ...IDLE_PROGRESS,
      phase: 'connecting',
      kind: 'export',
      startedAt: T0 + 10_000,
      now: T0 + 10_000,
    });
  });

  it('does nothing before a start', () => {
    for (const action of [
      { type: 'tick', at: T0 },
      { type: 'received', bytes: 10, at: T0 },
      { type: 'failed', failure: FAILURE, at: T0 },
    ] as const)
      expect(importProgressReducer(IDLE_PROGRESS, action)).toBe(IDLE_PROGRESS);
    expect(stageText(IDLE_PROGRESS)).toBe('');
    expect(elapsedMs(IDLE_PROGRESS)).toBe(0);
  });

  it('shows an export read as a share of its announced size', () => {
    const state = run([
      { type: 'start', kind: 'export', at: T0 },
      { type: 'connected', at: T0 + 100, totalBytes: 2_000_000 },
      { type: 'received', bytes: 500_000, at: T0 + 200 },
      { type: 'counted', assets: 321, at: T0 + 300 },
    ]);
    expect(shareRead(state)).toBe(0.25);
    expect(progressCounters(state)).toBe('321 assets · 500 kB of 2.0 MB · 0:00');
    expect(stageText(state)).toBe('Reading the export from Cloud Storage…');
    const pull = run([{ type: 'start', kind: 'pull', at: T0 }]);
    expect(shareRead(pull)).toBeNull();
    expect(stageText(pull)).toBe('Asking Cloud Asset Inventory…');
  });

  it('keeps the same state object for a tick that changes nothing', () => {
    const state = run([{ type: 'start', kind: 'pull', at: T0 }]);
    expect(importProgressReducer(state, { type: 'tick', at: T0 })).toBe(state);
  });
});

describe('formatElapsed', () => {
  it('writes minutes and seconds, and hours when there are some', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(999)).toBe('0:00');
    expect(formatElapsed(4_000)).toBe('0:04');
    expect(formatElapsed(750_000)).toBe('12:30');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
    expect(formatElapsed(-5)).toBe('0:00');
  });
});
