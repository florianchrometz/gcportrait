// SPDX-License-Identifier: Apache-2.0
/**
 * Extra ticks in the timeline bar (pages/diagram/TimelineBar.tsx), in the app with in-process workers on
 * demo organisation S and a snapshot library holding an export and an estimated pull of its scope (and one of
 * another scope): two more markers, diamonds (`data-kind="extra"`, the estimated one hollow), named in their
 * tooltips; `[` steps onto the export like onto a day, which writes its id into the hash, draws it and says what it
 * is; a link naming it opens on it; "Play extras" toggles (that it is offered only with extra ticks is checked in
 * TimelineBar.test.tsx); axe. A link naming an export the library still lists but the data worker no longer finds,
 * or cannot read, says so in the readout.
 */
import type { Snapshot } from '@gcportrait/model';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createInProcessWorkers } from '../diagram/pipeline/inProcess';
import { ingestDemoDay } from '../diagram/testing/demoData';
import { fakeLibrary, storedRecord } from '../snapshots/testing';
import { expectNoAxeViolations } from '../test/axe';
import { currentLocation } from '../test/renderApp';
import type { TimelineOwner } from './extraTicks';
import { currentDay as current, openTimeline, shownDay } from './testing/bar';
import { createTickSource, type StoredExtra } from './worker/source';

const EXPORT = '01J0000000000000000000000E';
const PULL = '01J0000000000000000000000P';
const OTHER = '01J0000000000000000000000O';
const EXTRA = '2026-10-05T14:30:00Z';
const PULLED = '2026-09-20T08:00:00Z';

/** Demo S's assets on 5 October, as the export read at 14:30 that the library lists. */
function exportSnapshot(): Promise<Snapshot> {
  return ingestDemoDay('2026-10-05', {
    readTime: EXTRA,
    source: { kind: 'export', detail: 'export.json' },
    origin: 'export-sidecar',
    now: '2026-10-10T12:00:00Z',
  });
}

function library() {
  return fakeLibrary({
    records: [
      storedRecord(EXPORT, {
        source: 'export',
        readTime: EXTRA,
        readTimeSource: 'export-sidecar',
        detail: 'export.json',
      }),
      storedRecord(PULL, {
        source: 'api',
        readTime: PULLED,
        readTimeSource: 'estimated-max-update-time',
        estimatedReadTime: true,
        detail: 'live pull',
      }),
      storedRecord(OTHER, {
        source: 'export',
        readTime: '2026-10-01T00:00:00Z',
        scope: { kind: 'organization', id: '30000000002' },
      }),
    ],
  });
}

/** What the data worker finds for an extra tick: by default the export, read in full. */
type ExtraFinder = (owner: TimelineOwner, id: string) => Promise<StoredExtra | null>;

async function open(
  hash: string,
  finder?: ExtraFinder,
): Promise<{ container: HTMLElement; bar: HTMLElement }> {
  const extra = await exportSnapshot();
  const storedExtra =
    finder ??
    ((owner: TimelineOwner, id: string) =>
      Promise.resolve(
        owner.scopePath === 'organizations/30000000001' && id === EXTRA
          ? { version: EXPORT, load: () => Promise.resolve(extra) }
          : null,
      ));
  return openTimeline(hash, {
    workers: () => createInProcessWorkers({ ticks: createTickSource({ storedExtra }) }),
    snapshots: library(),
    selector: '[data-kind="extra"]',
  });
}

describe('extra ticks in the timeline bar', () => {
  it('shows the scope’s export and pull among the days as diamonds, the estimated one hollow, named', async () => {
    const { bar } = await open('snapshot=demo:S');
    const markers = [...bar.querySelectorAll<HTMLElement>('[data-state]')];
    expect(markers).toHaveLength(37);
    const extras = markers.filter((marker) => marker.dataset['kind'] === 'extra');
    expect(extras.map((marker) => marker.dataset['day'])).toEqual([PULLED, EXTRA]);
    // In time order: the pull after 20 September's day, the export after 5 October's.
    const days = markers.map((marker) => marker.dataset['day']);
    expect(days.indexOf(PULLED)).toBe(days.indexOf('2026-09-20') + 1);
    expect(days.indexOf(EXTRA)).toBe(days.indexOf('2026-10-05') + 1);
    const [pull, exported] = extras;
    expect(pull?.dataset['estimated']).toBe('true');
    expect(exported?.dataset['estimated']).toBeUndefined();
    expect(pull?.title).toMatch(/^pull 2026-09-\d\d \d\d:\d\d \(estimated\): ready$/);
    expect(exported?.title).toMatch(/^export 2026-10-0[56] \d\d:\d\d: ready$/);
    const slider = within(bar).getByRole('slider', { name: 'Timeline' });
    expect(slider.getAttribute('aria-valuemax')).toBe('36');
    expect(slider.getAttribute('aria-valuenow')).toBe('36');
    const play = within(bar).getByRole('button', { name: 'Play extras' });
    expect(play.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(play);
    expect(play.getAttribute('aria-pressed')).toBe('true');
    await expectNoAxeViolations(bar);
  }, 40_000);

  it('steps onto the export like onto a day: its id in the hash, drawn, said', async () => {
    const { container, bar } = await open('snapshot=demo:S');
    for (const day of ['2026-10-07', '2026-10-06']) {
      fireEvent.keyDown(document.body, { key: '[' });
      expect(currentLocation(container)).toBe(`/diagram#snapshot=demo:S&tick=${day}`);
    }
    fireEvent.keyDown(document.body, { key: '[' });
    expect(currentLocation(container)).toBe(`/diagram#snapshot=demo:S&tick=${EXTRA}`);
    await shownDay(bar, EXTRA);
    const readout = within(bar).getByTestId('timeline-readout');
    expect(readout.textContent).toMatch(/^export 2026-10-0[56] \d\d:\d\d · extra tick$/);
    expect(readout.getAttribute('title')).toMatch(
      /an extra tick, read time from the export's operation\.json\.$/,
    );
    expect(within(bar).getByRole('slider', { name: 'Timeline' }).getAttribute('aria-valuetext')).toMatch(
      /^export 2026-10-0[56] \d\d:\d\d, extra tick, read time from the export's operation\.json, on screen$/,
    );
    expect(container.querySelector('.dg-title-block')?.textContent).toContain('read 2026-10-05T');
    // One more step back is 5 October's day.
    fireEvent.keyDown(document.body, { key: '[' });
    expect(currentLocation(container)).toBe('/diagram#snapshot=demo:S&tick=2026-10-05');
  }, 60_000);

  it('opens on the export a link names', async () => {
    const { bar } = await open(`snapshot=demo:S&tick=${EXTRA}`);
    await shownDay(bar, EXTRA);
    expect(within(bar).getByRole('slider', { name: 'Timeline' }).getAttribute('aria-valuenow')).toBe('33');
  }, 40_000);

  it('says so when the export a link names is no longer stored: the snapshot itself is shown', async () => {
    // The library still lists it (a stale listing, another tab's delete); the data worker finds no copy.
    const { container, bar } = await open(`snapshot=demo:S&tick=${EXTRA}`, () => Promise.resolve(null));
    const readout = within(bar).getByTestId('timeline-readout');
    await waitFor(
      () => {
        expect(readout.textContent).toMatch(
          /^export 2026-10-0[56] \d\d:\d\d is no longer stored in this browser; the snapshot itself is shown\.$/,
        );
      },
      { timeout: 20_000 },
    );
    expect(current(bar)).not.toBe(EXTRA);
    expect(container.querySelector('.dg-title-block')?.textContent).toContain('read 2026-10-08T');
  }, 40_000);

  it('says why when the export stepped onto cannot be drawn', async () => {
    const unreadable: ExtraFinder = (owner, id) =>
      Promise.resolve(
        owner.scopePath === 'organizations/30000000001' && id === EXTRA
          ? { version: EXPORT, load: () => Promise.reject(new Error('The stored copy cannot be read.')) }
          : null,
      );
    const { container, bar } = await open('snapshot=demo:S', unreadable);
    for (let step = 0; step < 3; step += 1) fireEvent.keyDown(document.body, { key: '[' });
    expect(currentLocation(container)).toBe(`/diagram#snapshot=demo:S&tick=${EXTRA}`);
    const readout = within(bar).getByTestId('timeline-readout');
    await waitFor(
      () => {
        expect(readout.textContent).toMatch(
          /^export 2026-10-0[56] \d\d:\d\d could not be drawn: .*The stored copy cannot be read\.$/,
        );
      },
      { timeout: 20_000 },
    );
  }, 40_000);
});
