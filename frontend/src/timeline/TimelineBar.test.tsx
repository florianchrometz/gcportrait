// SPDX-License-Identifier: MIT
/**
 * The timeline bar (pages/diagram/TimelineBar.tsx) in the app with in-process workers, on demo organisation S and
 * its history: 35 markers, the view's day on the slider and in the readout, the three playback speeds (1 s by
 * default) and no "Play extras" without extra ticks, `[` and `]` and the step buttons moving the hash's `tick` (the
 * last day written as no tick), the day drawn as the current marker, playback running through the days to the last
 * one and stopping on a key press, and axe.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { expectNoAxeViolations } from '../test/axe';
import { currentLocation } from '../test/renderApp';
import { currentDay as current, openTimeline as open, shownDay as drawn } from './testing/bar';
import { tickTitle } from './ticks';

describe('the timeline bar', () => {
  it('shows the 35 days of the history, the snapshot’s own day on screen, the three playback speeds (1 s by default) and no “Play extras”', async () => {
    const { bar } = await open('snapshot=demo:S');
    const markers = bar.querySelectorAll('[data-state]');
    expect(markers).toHaveLength(35);
    expect((markers[0] as HTMLElement).dataset['day']).toBe('2026-09-04');
    expect(current(bar)).toBe('2026-10-08');
    expect(bar.querySelectorAll('[data-state="cached"]')).toHaveLength(34);
    const slider = within(bar).getByRole('slider', { name: 'Timeline' });
    expect(slider.getAttribute('aria-valuenow')).toBe('34');
    // The day is written in the viewer's locale ("Thursday, 8 October 2026" in en-GB, "Thursday, October 8, 2026"
    // in en-US, which is what a runner's C.UTF-8 locale gives), so the expected words are made the same way.
    const day = tickTitle({ at: Date.parse('2026-10-08T00:00:00Z') });
    expect(slider.getAttribute('aria-valuetext')).toBe(`${day}, the snapshot itself, on screen`);
    expect(within(bar).getByTestId('timeline-readout').textContent).toBe(`${day} · the snapshot`);
    expect(within(bar).getByRole('button', { name: 'Next day' }).getAttribute('aria-disabled')).toBe('true');
    // Playback's three speeds, one second by default (docs/timeline.md §6); without extra ticks, no "Play extras".
    const speeds = within(within(bar).getByRole('radiogroup', { name: 'Speed' })).getAllByRole('radio');
    expect(speeds.map((radio) => radio.textContent)).toEqual(['0.5 s', '1 s', '2 s']);
    expect(speeds.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(within(bar).queryByRole('button', { name: 'Play extras' })).toBeNull();
    await expectNoAxeViolations(bar);
  }, 40_000);

  it('moves with [ and ] and the step buttons, the day in the hash, the last day as no tick', async () => {
    const { container, bar } = await open('snapshot=demo:S');
    fireEvent.keyDown(document.body, { key: '[' });
    expect(currentLocation(container)).toBe('/diagram#snapshot=demo:S&tick=2026-10-07');
    await drawn(bar, '2026-10-07');
    await userEvent.click(within(bar).getByRole('button', { name: 'Previous day' }));
    expect(currentLocation(container)).toBe('/diagram#snapshot=demo:S&tick=2026-10-06');
    await drawn(bar, '2026-10-06');
    fireEvent.keyDown(document.body, { key: ']' });
    await userEvent.click(within(bar).getByRole('button', { name: 'Next day' }));
    expect(currentLocation(container)).toBe('/diagram#snapshot=demo:S');
    await drawn(bar, '2026-10-08');
    // The keys say why they cannot move past the end.
    fireEvent.keyDown(document.body, { key: ']' });
    expect(screen.getByTestId('timeline-keys-status').textContent).toMatch(
      /^This is the latest day of the timeline/,
    );
  }, 60_000);

  it('opens on the day a link names, and moves with the slider’s keys', async () => {
    const { container, bar } = await open('snapshot=demo:S&tick=2026-09-17');
    await drawn(bar, '2026-09-17');
    const slider = within(bar).getByRole('slider', { name: 'Timeline' });
    expect(slider.getAttribute('aria-valuenow')).toBe('13');
    slider.focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(currentLocation(container)).toBe('/diagram#snapshot=demo:S&tick=2026-09-18');
    await drawn(bar, '2026-09-18');
  }, 60_000);

  it('plays through the days to the last one, and stops on a key press', async () => {
    const { container, bar } = await open('snapshot=demo:S&tick=2026-10-06');
    await drawn(bar, '2026-10-06');
    await userEvent.click(within(bar).getByRole('radio', { name: /0\.5 s/ }));
    const play = within(bar).getByRole('button', { name: 'Play through the days' });
    await userEvent.click(play);
    expect(play.getAttribute('aria-pressed')).toBe('true');
    expect(play.getAttribute('aria-label')).toBe('Pause playback');
    await waitFor(
      () => {
        expect(currentLocation(container)).toBe('/diagram#snapshot=demo:S');
        expect(play.getAttribute('aria-label')).toBe('Play through the days');
      },
      { timeout: 20_000 },
    );
    expect(current(bar)).toBe('2026-10-08');
    // From the last day it starts again at the first; a key press stops it. The playback timer runs on fake time
    // from here (moving with the real clock, so the app's own waits still pass), which the test then jumps forward.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    try {
      await userEvent.click(play);
      expect(currentLocation(container)).toBe('/diagram#snapshot=demo:S&tick=2026-09-04');
      expect(play.getAttribute('aria-pressed')).toBe('true');
      act(() => {
        fireEvent.keyDown(document.body, { key: 'Shift' });
      });
      expect(play.getAttribute('aria-pressed')).toBe('false');
      // The first day finishes drawing, and four intervals pass: nothing moves.
      await drawn(bar, '2026-09-04');
      await act(() => vi.advanceTimersByTimeAsync(2_000));
      expect(currentLocation(container)).toBe('/diagram#snapshot=demo:S&tick=2026-09-04');
    } finally {
      vi.useRealTimers();
    }
  }, 60_000);
});
