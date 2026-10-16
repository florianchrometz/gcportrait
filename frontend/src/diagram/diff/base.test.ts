// SPDX-License-Identifier: MIT
/**
 * Which day a new diagram is compared with (base.ts): the day on screen when the view moves to another day,
 * the day the diagram on screen was compared with when only the view changed (so the markers stay for the day),
 * nothing for another snapshot or nothing on screen.
 */
import { describe, expect, it } from 'vitest';

import { diffFrom, type OnScreen } from './base';
import type { TickDiff } from './types';

function onScreen(tick: string | undefined, since?: TickDiff['since'], ref = 'demo:S'): OnScreen {
  const diff: TickDiff | undefined =
    since === undefined
      ? undefined
      : { since, added: [], removed: [], changed: [], ghosts: {}, earlier: {}, inside: {} };
  return {
    answer: {
      source: {
        ref,
        scope: 'example.com',
        readTime: '2026-09-08T00:00:00Z',
        assets: 1,
        ...(tick === undefined ? {} : { tick }),
      },
      ...(diff === undefined ? {} : { diff }),
    },
  };
}

describe('the day a new diagram is compared with', () => {
  it('is the day on screen when the view moves to another day, in either direction', () => {
    expect(diffFrom(onScreen('2026-09-07'), { snapshot: 'demo:S', tick: '2026-09-08' })).toEqual({
      tick: '2026-09-07',
    });
    expect(diffFrom(onScreen('2026-09-08'), { snapshot: 'demo:S', tick: '2026-09-07' })).toEqual({
      tick: '2026-09-08',
    });
  });

  it('names the snapshot’s own day as null, coming from it or going to it', () => {
    expect(diffFrom(onScreen(undefined), { snapshot: 'demo:S', tick: '2026-10-07' })).toEqual({ tick: null });
    expect(diffFrom(onScreen('2026-10-07'), { snapshot: 'demo:S' })).toEqual({ tick: '2026-10-07' });
  });

  it('keeps the day the diagram on screen was compared with while the day stays (lens, filters, flips)', () => {
    const shown = onScreen('2026-09-08', { tick: '2026-09-07', readTime: '2026-09-07T00:00:00Z' });
    expect(diffFrom(shown, { snapshot: 'demo:S', tick: '2026-09-08' })).toEqual({ tick: '2026-09-07' });
    const fromOwn = onScreen('2026-10-07', { readTime: '2026-10-08T00:00:00Z' });
    expect(diffFrom(fromOwn, { snapshot: 'demo:S', tick: '2026-10-07' })).toEqual({ tick: null });
  });

  it('asks for none while the day stays and the diagram on screen was compared with nothing', () => {
    expect(diffFrom(onScreen('2026-09-08'), { snapshot: 'demo:S', tick: '2026-09-08' })).toBeUndefined();
    expect(diffFrom(onScreen(undefined), { snapshot: 'demo:S' })).toBeUndefined();
  });

  it('asks for none with nothing on screen, another snapshot on screen, or no snapshot', () => {
    expect(diffFrom(null, { snapshot: 'demo:S', tick: '2026-09-08' })).toBeUndefined();
    expect(
      diffFrom(onScreen('2026-09-07', undefined, 'demo:M'), { snapshot: 'demo:S', tick: '2026-09-08' }),
    ).toBe(undefined);
    expect(diffFrom(onScreen('2026-09-07'), { snapshot: '' })).toBeUndefined();
  });
});
