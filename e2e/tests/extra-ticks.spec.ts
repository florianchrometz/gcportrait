// SPDX-License-Identifier: MIT
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';

import { drawingOf, expectNoAxeViolations, hashOf, openDiagram, primaryNav, scratchShot } from './support.js';
import {
  expectDrawn,
  playbackStopped,
  playUntil,
  recordHashes,
  stoppedPlayButton,
  timelineBar as timelineBarWithin,
} from './timelineSupport.js';

/**
 * Extra ticks (docs/timeline.md) in Chromium, in demo mode, on demo organisation M (example.com,
 * `organizations/30000000002`), in the viewer's time zone and locale fixed to UTC and en-GB so the labels are the
 * same on every machine:
 *
 * - a Cloud Asset Inventory export of the demo organisation (written by the demo generator as `exportAssets` writes
 *   it, the organisation as it was on 5 October) with its operation.json (read time 2026-10-05 14:30 UTC), imported
 *   on the Snapshots page, is an extra tick of demo M's timeline: a diamond among the days, named "export 2026-10-05
 *   14:30"; a press on it selects it (its id in the hash), the export is drawn (its read time in the title block),
 *   `[` and `]` step off and back onto it, and a reload keeps it; the Snapshots page lists it under its scope, where
 *   it is deleted, after which the timeline has no extra tick and a link naming it says so;
 * - the same export without its operation.json is an estimated extra tick (a hollow diamond, "(estimated)"), and one
 *   given a typed read time is not;
 * - a read time later than the browser's clock (fixed here) is noted at the import, and the extra tick sits at the
 *   present, saying why;
 * - playback leaves extra ticks out until "Play extras" is pressed (on Playwright's clock: no step waits for a real
 *   interval);
 * - axe on the diagram page with an extra tick on screen and on the Snapshots page with the scope's timeline, in
 *   light and dark.
 *
 * The export is generated once per worker (it is the same in every test); each test writes its own operation.json.
 * Screenshots go to e2e/.scratch/extra-ticks/ (git-ignored).
 */
const REPO = path.resolve(import.meta.dirname, '..', '..');
const DEMO_M = '/diagram#snapshot=demo:M';
const EXTRA = '2026-10-05T14:30:00Z';
const LABEL = 'example.com, read 2026-10-05 14:30 UTC, export.json';

test.use({ timezoneId: 'UTC', locale: 'en-GB' });
test.describe.configure({ timeout: 180_000 });

interface ExportFiles {
  readonly lines: string;
  readonly operation: string;
  /** The latest asset change in the lines: the read time estimated without the operation.json. */
  readonly latestChange: string;
}

/** Demo M's export of 5 October and its latest asset change, generated once by this worker. */
let generated: { readonly lines: string; readonly latestChange: string } | undefined;

/**
 * Demo organisation M on 5 October as an export of `organizations/30000000002` (the demo generator's `cai-export`
 * format: one asset per line, the protobuf spelling), written once per worker under the test output.
 */
function caiExport(testInfo: TestInfo): { readonly lines: string; readonly latestChange: string } {
  if (generated !== undefined) return generated;
  const dir = path.join(
    testInfo.project.outputDir,
    'extra-ticks-export',
    `worker-${String(testInfo.workerIndex)}`,
  );
  mkdirSync(dir, { recursive: true });
  const lines = path.join(dir, 'export.json');
  execFileSync(
    'pnpm',
    [
      '--silent',
      '--filter',
      '@gcportrait/demo-data',
      'generate',
      '--size',
      'M',
      '--format',
      'cai-export',
      '--tick',
      '2026-10-05',
      '--out',
      lines,
    ],
    { cwd: REPO, stdio: 'ignore' },
  );
  const latestChange = readFileSync(lines, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => (JSON.parse(line) as { update_time: string }).update_time)
    .reduce((latest, time) => (Date.parse(time) > Date.parse(latest) ? time : latest));
  generated = { lines, latestChange };
  return generated;
}

/** The worker's export of demo M, with this test's operation.json that names `readTime` as its read time. */
function exportFiles(testInfo: TestInfo, readTime: string = EXTRA): ExportFiles {
  const { lines, latestChange } = caiExport(testInfo);
  const dir = testInfo.outputPath('export');
  mkdirSync(dir, { recursive: true });
  const operation = path.join(dir, 'operation.json');
  writeFileSync(
    operation,
    JSON.stringify({
      name: 'organizations/30000000002/operations/ExportAssets/RESOURCE/7',
      metadata: {
        '@type': 'type.googleapis.com/google.cloud.asset.v1.ExportAssetsRequest',
        contentType: 'RESOURCE',
        parent: 'organizations/30000000002',
      },
      done: true,
      response: {
        '@type': 'type.googleapis.com/google.cloud.asset.v1.ExportAssetsResponse',
        readTime,
      },
    }),
  );
  return { lines, operation, latestChange };
}

/** The Snapshots page, through the top bar. */
async function snapshotsPage(page: Page): Promise<void> {
  await primaryNav(page).getByRole('link', { name: 'Snapshots' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Snapshots' })).toBeVisible();
}

/** "2026-10-05 14:30 UTC": a read time as the Snapshots page writes it. */
function utcMinute(readTime: string): string {
  return `${new Date(readTime).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * Imports `files` through the Snapshots page's import (its file input, as "Choose files…" fills it; snapshots.spec.ts
 * drives the button's file chooser), and waits until it announces the export read at `readTime`.
 */
async function importFiles(
  page: Page,
  files: readonly string[],
  readTime: string,
  typed?: string,
): Promise<void> {
  if (typed !== undefined)
    await page.getByRole('textbox', { name: 'When the export was taken (UTC, optional)' }).fill(typed);
  await page
    .getByTestId('snapshot-drop-zone')
    .locator('input[type="file"]')
    .setInputFiles([...files]);
  await expect(
    page.getByText(`Imported example.com, read ${utcMinute(readTime)}, export.json (`),
  ).toBeVisible({
    timeout: 60_000,
  });
}

/** The scope's part of "Timelines by scope". */
function scopeTimeline(page: Page): Locator {
  return page
    .getByRole('region', { name: 'Timelines by scope' })
    .getByRole('region', { name: /^example\.com/ });
}

/** The timeline bar, once the snapshot's timeline is known (a minute at most: the import has its work to do). */
function timelineBar(page: Page): Promise<Locator> {
  return timelineBarWithin(page, 60_000);
}

test('an imported export of the demo organisation is an extra tick: selected, drawn, linked, then deleted', async ({
  page,
}, testInfo) => {
  const files = exportFiles(testInfo);
  await page.goto('/snapshots');
  await importFiles(page, [files.lines, files.operation], EXTRA);
  await expect(page.getByText(`Imported ${LABEL} (`)).toBeVisible();

  // The Snapshots page lists it under its scope, as an extra tick with where its read time came from.
  const scope = scopeTimeline(page);
  await expect(scope.getByText(/^1 extra tick: [\d.]+ (kB|MB) in this browser\.$/)).toBeVisible();
  const row = scope.locator('tbody tr');
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('rowheader')).toHaveText('2026-10-05 14:30 UTC');
  await expect(row.getByRole('cell').nth(0)).toHaveText(
    "Extra tick · Export fileread time from the export's operation.json · export.json",
  );

  // On demo M's timeline: a diamond after 5 October's day, named by its label.
  await openDiagram(page, DEMO_M);
  const bar = await timelineBar(page);
  await expect(bar.locator('[data-state]')).toHaveCount(36);
  const marker = bar.locator(`[data-day="${EXTRA}"]`);
  await expect(marker).toHaveAttribute('data-kind', 'extra');
  await expect(marker).toHaveAttribute('title', 'export 2026-10-05 14:30: ready');
  await expect(marker).not.toHaveAttribute('data-estimated', 'true');
  const days = await bar
    .locator('[data-state]')
    .evaluateAll((markers) => markers.map((element) => element.getAttribute('data-day')));
  expect(days.indexOf(EXTRA)).toBe(days.indexOf('2026-10-05') + 1);
  await expect(bar.getByRole('button', { name: 'Play extras' })).toHaveAttribute('aria-pressed', 'false');
  await scratchShot(bar, 'extra-ticks', 'bar-M-extra-light');

  // A press on it selects it, like a day: its id in the hash, the export drawn.
  const ownDay = await drawingOf(page);
  await marker.click();
  await expect.poll(() => hashOf(page)).toBe(`#snapshot=demo:M&tick=${EXTRA}`);
  await expectDrawn(bar, EXTRA, ownDay);
  const svg = page.locator('svg.dg-canvas[data-diagram-ready="true"]');
  await expect(svg.locator('.dg-title-block')).toContainText('read 2026-10-05T14:30:00+00:00');
  await expect(bar.getByTestId('timeline-readout')).toHaveText('export 2026-10-05 14:30 · extra tick');
  await expect(bar.getByTestId('timeline-readout')).toHaveAttribute(
    'title',
    "export 2026-10-05 14:30: an extra tick, read time from the export's operation.json.",
  );
  await expect(bar.getByRole('slider', { name: 'Timeline' })).toHaveAttribute(
    'aria-valuetext',
    "export 2026-10-05 14:30, extra tick, read time from the export's operation.json, on screen",
  );
  await scratchShot(page, 'extra-ticks', 'diagram-M-extra-light');

  // [ and ] step off it and back onto it, like days.
  await page.locator('main').focus();
  const extra = await drawingOf(page);
  await page.keyboard.press('[');
  await expect.poll(() => hashOf(page)).toBe('#snapshot=demo:M&tick=2026-10-05');
  await expectDrawn(bar, '2026-10-05', extra);
  const fifth = await drawingOf(page);
  await page.keyboard.press(']');
  await expect.poll(() => hashOf(page)).toBe(`#snapshot=demo:M&tick=${EXTRA}`);
  await expectDrawn(bar, EXTRA, fifth);

  // A reload keeps it.
  await page.reload();
  const again = await timelineBar(page);
  await expectDrawn(again, EXTRA);
  await expect(page.locator('svg.dg-canvas .dg-title-block')).toContainText('read 2026-10-05T14:30:00+00:00');

  // Deleted on the Snapshots page, after a confirmation: gone from the scope and from the timeline.
  await snapshotsPage(page);
  await scopeTimeline(page)
    .getByRole('button', { name: `Delete the extra tick ${LABEL}` })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Delete this extra tick?' });
  await expect(dialog).toContainText(`${LABEL}, `);
  await scratchShot(page, 'extra-ticks', 'snapshots-delete-extra-light');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(`Deleted the extra tick ${LABEL}.`)).toBeVisible();
  await expect(scopeTimeline(page)).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 2, name: 'Timelines by scope' })).toBeFocused();
  await expect(page.getByText('Nothing is kept in this browser yet.')).toBeVisible();

  // The link that named it now says it is not kept, and draws the snapshot itself.
  await openDiagram(page, `${DEMO_M}&tick=${EXTRA}`);
  const after = await timelineBar(page);
  await expect(after.locator('[data-state]')).toHaveCount(35);
  await expect(after.locator('[data-kind="extra"]')).toHaveCount(0);
  await expect(after.getByTestId('timeline-readout')).toHaveText(
    `No export or pull of this scope read at ${EXTRA} is kept in this browser; the snapshot itself is shown.`,
  );
  await expect(page.locator('svg.dg-canvas .dg-title-block')).toContainText('read 2026-10-08T00:00:00+00:00');
  await expect(after.getByRole('button', { name: 'Play extras' })).toHaveCount(0);
});

test('an export whose read time is later than the clock is noted at the import and sits at the present', async ({
  page,
}, testInfo) => {
  await page.clock.setFixedTime(new Date('2026-10-10T12:00:00Z'));
  const ahead = '2026-10-11T08:00:00Z';
  const files = exportFiles(testInfo, ahead);
  await page.goto('/snapshots');
  await importFiles(page, [files.lines, files.operation], ahead);
  await expect(
    page.getByText(
      "Its read time, 2026-10-11 08:00 UTC, is later than this computer's clock; its scope's timeline shows it at " +
        'the present until then.',
    ),
  ).toBeVisible();
  await openDiagram(page, DEMO_M);
  const bar = await timelineBar(page);
  // After the history's last day (8 October): at the present, not in the future.
  await expect(bar.locator('[data-state]').last()).toHaveAttribute('data-day', ahead);
  const ownDay = await drawingOf(page);
  await bar.locator(`[data-day="${ahead}"]`).click();
  await expectDrawn(bar, ahead, ownDay);
  const readout = bar.getByTestId('timeline-readout');
  await expect(readout).toHaveText('export 2026-10-11 08:00 · extra tick, shown at the present');
  await expect(readout).toHaveAttribute(
    'title',
    /has a read time later than this browser's clock, so the timeline shows it at the present\.$/,
  );
  await expect(bar.getByRole('slider', { name: 'Timeline' })).toHaveAttribute(
    'aria-valuetext',
    /, placed at the present, on screen$/,
  );
});

test('an export without its operation.json is an estimated extra tick; one with a typed read time is not', async ({
  page,
}, testInfo) => {
  const files = exportFiles(testInfo);
  const estimated = `${new Date(files.latestChange).toISOString().slice(0, 19)}Z`;
  await page.goto('/snapshots');
  await importFiles(page, [files.lines], files.latestChange);
  await expect(
    page.getByText('The export does not say when it was taken, so its read time is the latest asset change,'),
  ).toBeVisible();
  await importFiles(page, [files.lines], '2026-09-30T08:00:00Z', '2026-09-30 08:00');
  const scope = scopeTimeline(page);
  await expect(scope.locator('tbody tr')).toHaveCount(2);
  await expect(scope.locator('tbody tr').nth(0).getByRole('rowheader')).toHaveText(
    '2026-09-30 08:00 UTCentered',
  );
  await expect(scope.locator('tbody tr').nth(1).getByRole('rowheader')).toContainText('estimated');

  await openDiagram(page, DEMO_M);
  const bar = await timelineBar(page);
  await expect(bar.locator('[data-kind="extra"]')).toHaveCount(2);
  const hollow = bar.locator(`[data-day="${estimated}"]`);
  await expect(hollow).toHaveAttribute('data-estimated', 'true');
  await expect(hollow).toHaveAttribute(
    'title',
    /^export \d{4}-\d{2}-\d{2} \d{2}:\d{2} \(estimated\): ready$/,
  );
  const typed = bar.locator('[data-day="2026-09-30T08:00:00Z"]');
  await expect(typed).not.toHaveAttribute('data-estimated', 'true');
  await expect(typed).toHaveAttribute('title', 'export 2026-09-30 08:00: ready');
  const ownDay = await drawingOf(page);
  await typed.click();
  await expectDrawn(bar, '2026-09-30T08:00:00Z', ownDay);
  await expect(bar.getByRole('slider', { name: 'Timeline' })).toHaveAttribute(
    'aria-valuetext',
    'export 2026-09-30 08:00, extra tick, read time entered when it was loaded, on screen',
  );
  await scratchShot(bar, 'extra-ticks', 'bar-M-estimated-light');
});

/**
 * Plays from 4 October to the last day at 0.5 s a step, on Playwright's clock, and answers the hashes written on the
 * way.
 */
async function playFromOctober4(page: Page, withExtras: boolean): Promise<string[]> {
  // A page loaded afresh, whose first drawing is the 4th's: from the diagram a link that changes only the hash keeps
  // the page, and the last day's drawing on the canvas until the 4th's replaces it.
  await page.goto('about:blank');
  await openDiagram(page, `${DEMO_M}&tick=2026-10-04`);
  const bar = await timelineBar(page);
  await expectDrawn(bar, '2026-10-04');
  await bar.getByRole('radio', { name: /0\.5 s/ }).click();
  const toggle = bar.getByRole('button', { name: 'Play extras' });
  if (withExtras) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', String(withExtras));
  const recorded = await recordHashes(page);
  const fourth = await drawingOf(page);
  await stoppedPlayButton(bar).click();
  await expect(bar.getByRole('button', { name: 'Pause playback' })).toBeVisible();
  // It stops by itself on the last day (the snapshot itself: no tick).
  await playUntil(page, () => playbackStopped(bar));
  await expectDrawn(bar, '2026-10-08', fourth);
  return recorded();
}

test('playback leaves the extra ticks out until "Play extras" is pressed', async ({ page }, testInfo) => {
  await page.clock.install();
  const files = exportFiles(testInfo);
  await page.goto('/snapshots');
  await importFiles(page, [files.lines, files.operation], EXTRA);
  const ticks = (hashes: readonly string[]): string[] =>
    hashes.map((hash) => /tick=([^&]+)/.exec(hash)?.[1] ?? 'own day');
  expect(ticks(await playFromOctober4(page, false))).toEqual([
    '2026-10-05',
    '2026-10-06',
    '2026-10-07',
    'own day',
  ]);
  expect(ticks(await playFromOctober4(page, true))).toEqual([
    '2026-10-05',
    EXTRA,
    '2026-10-06',
    '2026-10-07',
    'own day',
  ]);
});

for (const scheme of ['light', 'dark'] as const) {
  test(`the diagram with an extra tick on screen and the Snapshots page pass axe in ${scheme}`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme: scheme });
    const files = exportFiles(testInfo);
    await page.goto('/snapshots');
    await importFiles(page, [files.lines, files.operation], EXTRA);
    await importFiles(page, [files.lines], files.latestChange);
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await expect(scopeTimeline(page).locator('tbody tr')).toHaveCount(2);
    await expectNoAxeViolations(page);
    await scratchShot(
      page.getByRole('region', { name: 'Timelines by scope' }),
      'extra-ticks',
      `snapshots-timelines-${scheme}`,
    );

    await openDiagram(page, `${DEMO_M}&tick=${EXTRA}`);
    const bar = await timelineBar(page);
    await expectDrawn(bar, EXTRA);
    await expectNoAxeViolations(page);
    await scratchShot(bar, 'extra-ticks', `bar-M-extra-current-${scheme}`);
    await scratchShot(page, 'extra-ticks', `diagram-M-extra-${scheme}`);
  });
}
