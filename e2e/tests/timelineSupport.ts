// SPDX-License-Identifier: MIT
import { expect, type Locator, type Page } from '@playwright/test';

import { drawnCanvas, redrawnCanvas } from './support.js';

/**
 * Helpers for the timeline's specs (timeline, diff, extra-ticks): the bar, the day on screen, scrubbing, the hashes
 * the timeline writes in place, and playback on Playwright's clock.
 */

/** The timeline bar, once the snapshot's timeline is known (within `timeout` ms, Playwright's default otherwise). */
export async function timelineBar(page: Page, timeout?: number): Promise<Locator> {
  const bar = page.getByRole('region', { name: 'Timeline' });
  await expect(bar).toHaveAttribute('data-ready', 'true', timeout === undefined ? {} : { timeout });
  return bar;
}

/**
 * Waits until `day` (a day, or an extra tick's read time) is the one on screen and drawn, fitted and interactive. The
 * day's marker turns current in the commit that puts its drawing up, before the painter attaches to it, and the canvas
 * keeps the ready flag of the drawing before it until then; so after the day moved (a scrub, `[` or `]`, a step
 * button, a marker, Back, playback), `previous` is the number of the drawing on screen before the move (`drawingOf`),
 * and only a drawing after it counts. Without it, the first drawing of a page just opened or reloaded.
 */
export async function expectDrawn(bar: Locator, day: string, previous?: string): Promise<void> {
  await expect(bar.locator('[data-state="current"]')).toHaveAttribute('data-day', day, { timeout: 60_000 });
  const page = bar.page();
  if (previous === undefined) await drawnCanvas(page);
  else await redrawnCanvas(page, previous);
}

/** Drags the slider's thumb to the marker of `day`, as a person scrubs, in `steps` pointer moves. */
export async function scrubTo(page: Page, bar: Locator, day: string, steps = 12): Promise<void> {
  const thumb = bar.getByRole('slider', { name: 'Timeline' });
  const from = await thumb.boundingBox();
  const to = await bar.locator(`[data-day="${day}"]`).boundingBox();
  if (from === null || to === null) throw new Error('the slider is not laid out');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, from.y + from.height / 2, { steps });
  await page.mouse.up();
}

/**
 * Records every hash the page writes from now on (the timeline writes them in place: no navigation event), `#`
 * included and percent-decoded; answers a reader of what was recorded.
 */
export async function recordHashes(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { recordedHashes: string[] }).recordedHashes = seen;
    for (const name of ['pushState', 'replaceState'] as const) {
      const original = history[name].bind(history);
      history[name] = (...args: Parameters<History['pushState']>) => {
        original(...args);
        seen.push(decodeURIComponent(location.hash));
      };
    }
  });
  return () => page.evaluate(() => [...(window as unknown as { recordedHashes: string[] }).recordedHashes]);
}

/**
 * Lets playback run on Playwright's clock (`page.clock.install()` before the page loaded) until `done` holds: while it
 * does not, the page's time jumps one step of `stepMs` ahead, so a step waits for no real interval.
 */
export async function playUntil(page: Page, done: () => Promise<boolean>, stepMs = 500): Promise<void> {
  await expect
    .poll(
      async () => {
        if (await done()) return true;
        await page.clock.fastForward(stepMs);
        return false;
      },
      { intervals: [100], timeout: 30_000 },
    )
    .toBe(true);
}

/** The play button while playback is stopped (playing, it is named "Pause playback"). */
export function stoppedPlayButton(bar: Locator): Locator {
  return bar.getByRole('button', { name: 'Play through the days' });
}

/** Whether playback has stopped: the play button is back, not pressed. */
export async function playbackStopped(bar: Locator): Promise<boolean> {
  const play = stoppedPlayButton(bar);
  return (await play.count()) === 1 && (await play.getAttribute('aria-pressed')) === 'false';
}

/** Waits two frames in the page, so that whatever a fired timer started has been drawn and written. */
export async function twoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve();
          });
        });
      }),
  );
}
