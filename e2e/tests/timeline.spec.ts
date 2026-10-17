// SPDX-License-Identifier: MIT
import { expect, test } from '@playwright/test';

import {
  drawingOf,
  drawnCanvas,
  expectNoAxeViolations,
  hashOf,
  openDiagram,
  scratchShot,
} from './support.js';
import {
  expectDrawn,
  playbackStopped,
  playUntil,
  recordHashes,
  scrubTo,
  stoppedPlayButton,
  timelineBar,
  twoFrames,
} from './timelineSupport.js';

/**
 * The timeline (docs/timeline.md) in Chromium on demo organisation M and its 35-day history, in the viewer's
 * time zone and locale fixed to UTC and en-GB here so the dates are the same on every machine:
 *
 * - the bar: 35 markers from 4 Sept to 8 Oct, the snapshot's own day on screen;
 * - scrubbing: a drag along the slider to 16 September draws that day (its read time in the title block, the
 *   decommissioned reports project still there), one day on (17 September, the day it was deleted) it is gone, and
 *   each day is in the hash (`tick`), the slider moving in place (no history entry per day);
 * - `[` and `]` move one day back and forward, the last day as no tick, and say why they cannot move past it;
 * - a link with a tick opens on that day, and a reload keeps it;
 * - playback runs through the days to the last one and stops there, and stops on a key press (on Playwright's clock,
 *   so no step waits for a real interval);
 * - axe on the diagram page with the bar, in light and dark.
 *
 * Screenshots of the bar go to e2e/.scratch/timeline/ (git-ignored).
 */
const DEMO_M = '/diagram#snapshot=demo:M';
/** demo-reports-1, deleted on 17 September (packages/demo-data README "History": tick 13). */
const REPORTS_PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000008';

test.use({ timezoneId: 'UTC', locale: 'en-GB' });
test.describe.configure({ timeout: 120_000 });

test('shows the 35 days of the history, the snapshot’s own day on screen', async ({ page }) => {
  await openDiagram(page, DEMO_M);
  const bar = await timelineBar(page);
  await expect(bar.locator('[data-state]')).toHaveCount(35);
  await expect(bar.locator('[data-state]').first()).toHaveAttribute('data-day', '2026-09-04');
  await expect(bar.locator('[data-state="cached"]')).toHaveCount(34);
  await expectDrawn(bar, '2026-10-08');
  await expect(bar).toContainText('4 Sept');
  await expect(bar).toContainText('8 Oct');
  const slider = bar.getByRole('slider', { name: 'Timeline' });
  await expect(slider).toHaveAttribute('aria-valuenow', '34');
  await expect(slider).toHaveAttribute('aria-valuetext', /8 October 2026, the snapshot itself, on screen$/);
  await expect(bar.getByTestId('timeline-readout')).toHaveText(/8 October 2026 · the snapshot$/);
  await expect(bar.getByRole('button', { name: 'Next day' })).toHaveAttribute('aria-disabled', 'true');
});

test('scrubbing to a day with changes draws that day, and the day is in the hash', async ({ page }) => {
  const svg = await openDiagram(page, DEMO_M);
  const bar = await timelineBar(page);
  const entries = await page.evaluate(() => history.length);
  const ownDay = await drawingOf(page);
  await scrubTo(page, bar, '2026-09-16');
  await expect.poll(() => hashOf(page)).toBe('#snapshot=demo:M&tick=2026-09-16');
  await expectDrawn(bar, '2026-09-16', ownDay);
  await expect(svg.locator('.dg-title-block')).toContainText(
    'Overview lens · read 2026-09-16T00:00:00+00:00',
  );
  await expect(svg.locator(`[data-id="${REPORTS_PROJECT}"]`)).toHaveCount(1);
  await expect(bar.getByTestId('timeline-readout')).toHaveText('Wednesday, 16 September 2026');
  // The day the reports project was deleted: it is gone.
  const sixteenth = await drawingOf(page);
  await scrubTo(page, bar, '2026-09-17');
  await expect.poll(() => hashOf(page)).toBe('#snapshot=demo:M&tick=2026-09-17');
  await expectDrawn(bar, '2026-09-17', sixteenth);
  await expect(svg.locator('.dg-title-block')).toContainText('read 2026-09-17T00:00:00+00:00');
  await expect(svg.locator(`[data-id="${REPORTS_PROJECT}"]`)).toHaveCount(0);
  // A drag moves the view in place: no history entry per day.
  expect(await page.evaluate(() => history.length)).toBe(entries);
  await scratchShot(page, 'timeline', 'timeline-M-2026-09-17-light');
});

test('[ and ] move one day back and forward; past the last day they say why they cannot', async ({
  page,
}) => {
  await openDiagram(page, DEMO_M);
  const bar = await timelineBar(page);
  await page.locator('main').focus();
  const ownDay = await drawingOf(page);
  await page.keyboard.press('[');
  await expect.poll(() => hashOf(page)).toBe('#snapshot=demo:M&tick=2026-10-07');
  await expectDrawn(bar, '2026-10-07', ownDay);
  const seventh = await drawingOf(page);
  await page.keyboard.press('[');
  await expect.poll(() => hashOf(page)).toBe('#snapshot=demo:M&tick=2026-10-06');
  await expectDrawn(bar, '2026-10-06', seventh);
  await expect(bar.getByRole('slider', { name: 'Timeline' })).toHaveAttribute(
    'aria-valuetext',
    'Tuesday, 6 October 2026, on screen',
  );
  // The step buttons and Back: each step was a history entry.
  const sixth = await drawingOf(page);
  await bar.getByRole('button', { name: 'Next day' }).click();
  await expect.poll(() => hashOf(page)).toBe('#snapshot=demo:M&tick=2026-10-07');
  await page.goBack();
  await expect.poll(() => hashOf(page)).toBe('#snapshot=demo:M&tick=2026-10-06');
  await page.locator('main').focus();
  await page.keyboard.press(']');
  await page.keyboard.press(']');
  // The last day is the snapshot itself: the hash names no tick.
  await expect.poll(() => hashOf(page)).toBe('#snapshot=demo:M');
  await expectDrawn(bar, '2026-10-08', sixth);
  await page.keyboard.press(']');
  await expect(page.getByTestId('timeline-keys-status')).toHaveText(
    'This is the latest day of the timeline (8 Oct).',
  );
  expect(hashOf(page)).toBe('#snapshot=demo:M');
});

test('a link with a tick opens on that day, and a reload keeps it', async ({ page }) => {
  const svg = await openDiagram(page, `${DEMO_M}&lens=networking&tick=2026-09-20`);
  const bar = await timelineBar(page);
  await expectDrawn(bar, '2026-09-20');
  const slider = bar.getByRole('slider', { name: 'Timeline' });
  await expect(slider).toHaveAttribute('aria-valuenow', '16');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Sunday, 20 September 2026, on screen');
  await expect(svg.locator('.dg-title-block')).toContainText(
    'Networking lens · read 2026-09-20T00:00:00+00:00',
  );
  await page.reload();
  await drawnCanvas(page);
  const again = await timelineBar(page);
  await expectDrawn(again, '2026-09-20');
  expect(hashOf(page)).toBe('#snapshot=demo:M&lens=networking&tick=2026-09-20');
  await expect(page.locator('svg.dg-canvas .dg-title-block')).toContainText('read 2026-09-20T00:00:00+00:00');
});

test('playback runs through the days to the last one, and a key press stops it', async ({ page }) => {
  // Playwright's clock: a step's 0.5 s passes at once (playUntil), and so do the 2 s after the key press.
  await page.clock.install();
  await openDiagram(page, `${DEMO_M}&tick=2026-10-05`);
  const bar = await timelineBar(page);
  await expectDrawn(bar, '2026-10-05');
  await bar.getByRole('radio', { name: /0\.5 s/ }).click();
  const played = await recordHashes(page);
  const fifth = await drawingOf(page);
  await stoppedPlayButton(bar).click();
  await expect(bar.getByRole('button', { name: 'Pause playback' })).toHaveAttribute('aria-pressed', 'true');
  await scratchShot(page, 'timeline', 'timeline-M-playing-light');
  // 6, 7, then the last day (no tick), where it stops by itself.
  await playUntil(page, () => playbackStopped(bar));
  expect(await played()).toEqual([
    '#snapshot=demo:M&tick=2026-10-06',
    '#snapshot=demo:M&tick=2026-10-07',
    '#snapshot=demo:M',
  ]);
  await expectDrawn(bar, '2026-10-08', fifth);
  // From the last day it starts again at the first; any key stops it.
  const replayed = await recordHashes(page);
  await stoppedPlayButton(bar).click();
  await expect.poll(() => hashOf(page)).toBe('#snapshot=demo:M&tick=2026-09-04');
  await playUntil(page, async () => (await replayed()).includes('#snapshot=demo:M&tick=2026-09-05'));
  await page.keyboard.press('Shift');
  await expect(stoppedPlayButton(bar)).toHaveAttribute('aria-pressed', 'false');
  expect((await replayed()).slice(0, 2)).toEqual([
    '#snapshot=demo:M&tick=2026-09-04',
    '#snapshot=demo:M&tick=2026-09-05',
  ]);
  // Stopped: the time of several steps passes, and the day on screen stays.
  const at = await page.evaluate(() => location.hash);
  await page.clock.fastForward(2000);
  await twoFrames(page);
  expect(await page.evaluate(() => location.hash)).toBe(at);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the diagram page with the timeline passes axe in ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await openDiagram(page, `${DEMO_M}&tick=2026-09-20`);
    const bar = await timelineBar(page);
    await expectDrawn(bar, '2026-09-20');
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await expectNoAxeViolations(page);
    await scratchShot(bar, 'timeline', `timeline-bar-M-${scheme}`);
  });
}
