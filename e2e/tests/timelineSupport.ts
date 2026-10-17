// SPDX-License-Identifier: MIT
import { expect, type Locator, type Page } from '@playwright/test';

import { boxOf, drawnCanvas, redrawnCanvas, type Box } from './support.js';

/**
 * Helpers for the timeline's specs (timeline, diff, extra-ticks, and the timeline's tests in handheld and mobile):
 * the bar, the day on screen, scrubbing and a press on the slider's thumb, its focus ring and what the ring covers,
 * the hashes the timeline writes in place, and playback on Playwright's clock.
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

/** Presses the slider's thumb with the mouse where it is (the day stays) and lets go. */
export async function pressThumb(page: Page, bar: Locator): Promise<void> {
  const box = await bar.getByRole('slider', { name: 'Timeline' }).boundingBox();
  if (box === null) throw new Error('the slider is not laid out');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.up();
}

/**
 * Whether `control` shows a focus ring: the chrome ring's box shadows or its outline (global.css draws both), round the
 * control, or round its dot for a slider's thumb on a phone or a tablet (`::after`, ui/Slider).
 */
export function focusRingShown(control: Locator): Promise<boolean> {
  return control.evaluate((element) => {
    const dot = getComputedStyle(element, '::after');
    return [getComputedStyle(element), ...(dot.content === 'none' ? [] : [dot])].some(
      (style) => style.boxShadow !== 'none' || style.outlineStyle !== 'none',
    );
  });
}

/**
 * The box that the focus ring of `control` covers, or null when it shows none: its outer box shadows and its outline
 * (transparent or not, as forced-colours mode draws it) round the control, or round a slider thumb's dot on a phone or
 * a tablet (`::after`, which ui/Slider centres in the thumb's touch box).
 */
export function focusRingBox(control: Locator): Promise<Box | null> {
  return control.evaluate((element) => {
    const own = element.getBoundingClientRect();
    const dot = getComputedStyle(element, '::after');
    const dotWidth = Number.parseFloat(dot.width);
    const dotHeight = Number.parseFloat(dot.height);
    const drawers: { readonly style: CSSStyleDeclaration; readonly box: readonly number[] }[] = [
      { style: getComputedStyle(element), box: [own.left, own.top, own.right, own.bottom] },
    ];
    if (dot.content !== 'none' && dotWidth > 0 && dotHeight > 0) {
      const x = own.left + own.width / 2;
      const y = own.top + own.height / 2;
      drawers.push({
        style: dot,
        box: [x - dotWidth / 2, y - dotHeight / 2, x + dotWidth / 2, y + dotHeight / 2],
      });
    }
    // Each shadow's and the outline's box, as left, top, right, bottom.
    const covers: (readonly [number, number, number, number])[] = [];
    for (const { style, box } of drawers) {
      const [left = 0, top = 0, right = 0, bottom = 0] = box;
      if (style.boxShadow !== 'none')
        for (const shadow of style.boxShadow.split(/,(?![^(]*\))/)) {
          if (shadow.includes('inset')) continue;
          const [x = 0, y = 0, blur = 0, spread = 0] = shadow
            .replace(/rgba?\([^)]*\)/, '')
            .trim()
            .split(/\s+/)
            .map((length) => Number.parseFloat(length));
          const reach = spread + blur;
          covers.push([left + x - reach, top + y - reach, right + x + reach, bottom + y + reach]);
        }
      if (style.outlineStyle !== 'none') {
        const reach = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
        covers.push([left - reach, top - reach, right + reach, bottom + reach]);
      }
    }
    if (covers.length === 0) return null;
    const left = Math.min(...covers.map((cover) => cover[0]));
    const top = Math.min(...covers.map((cover) => cover[1]));
    const right = Math.max(...covers.map((cover) => cover[2]));
    const bottom = Math.max(...covers.map((cover) => cover[3]));
    return { x: left, y: top, width: right - left, height: bottom - top };
  });
}

/**
 * What the slider thumb's focus ring covers of the dates at the track's ends and of the readout, each as its words and
 * the size of the part covered ("the date "Oct 8": 20.0 × 13.0 px"; half a pixel of rounding allowed): none, as the
 * bar keeps the ring's reach between the track and the dates (TimelineBar.module.css). Fails when the ring is not shown.
 */
export async function coveredByThumbRing(bar: Locator): Promise<string[]> {
  const ring = await focusRingBox(bar.getByRole('slider', { name: 'Timeline' }));
  if (ring === null) throw new Error('the thumb shows no focus ring');
  // The text shown for the eye only that holds a digit: the two dates.
  const dates = bar.locator('[aria-hidden="true"]').filter({ hasText: /\d/ });
  await expect(dates).toHaveCount(2);
  const readout = bar.getByTestId('timeline-readout');
  const covered: string[] = [];
  for (const [label, part] of [
    ['the date', dates.first()],
    ['the date', dates.last()],
    ['the readout', readout],
  ] as const) {
    const box = await boxOf(part);
    const width = Math.min(ring.x + ring.width, box.x + box.width) - Math.max(ring.x, box.x);
    const height = Math.min(ring.y + ring.height, box.y + box.height) - Math.max(ring.y, box.y);
    if (width > 0.5 && height > 0.5)
      covered.push(`${label} "${await part.innerText()}": ${width.toFixed(1)} × ${height.toFixed(1)} px`);
  }
  return covered;
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
