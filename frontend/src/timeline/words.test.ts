// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * The timeline readout's words (words.ts) for its harder cases: a read's progress names
 * the day short so its size and time fit; a snapshot read after the timeline's last day says so (not "before"); an
 * extra tick that could not be drawn, or that is no longer stored, says so instead of "Drawing …" for good; an extra
 * tick older than the timeline says why it is not on it; a day that could not be drawn says why.
 */
import { describe, expect, it } from 'vitest';

import { IDLE_PROGRESS } from '../import/progress';
import type { ExtraTick } from './extraTicks';
import { historyInfo, LIVE_INFO, modelFor as model } from './testing/fixtures';
import type { TimelineInfo } from './types';
import { readout } from './words';

const UTC = { timeZone: 'UTC', locale: 'en-GB' } as const;
const HISTORY = historyInfo();
const REF = '01J0000000000000000000000A';

function extra(readTime: string): ExtraTick {
  return {
    id: readTime,
    ref: '01J0000000000000000000000E',
    source: 'export',
    readTime,
    readTimeSource: 'export-sidecar',
    at: Date.parse(readTime),
    future: false,
    copies: 1,
    assetCount: 96,
    bytes: 4_000,
  };
}

const quiet = { progress: null, failure: null, blocked: null, labels: UTC } as const;

describe('the readout', () => {
  it('names the day short while a live day is read, so the counters, the size and the time fit', () => {
    const live = LIVE_INFO;
    const loading = model(`snapshot=${REF}&tick=2026-09-30`, live, {
      extra: { status: { '2026-09-30': 'loading' } },
    });
    const said = readout({
      ...quiet,
      model: loading,
      progress: {
        ...IDLE_PROGRESS,
        kind: 'pull',
        phase: 'reading',
        pages: 12,
        assets: 4_800,
        bytes: 3_200_000,
        startedAt: 0,
        now: 5_000,
      },
    });
    expect(said.text).toMatch(/^Reading 30 Sept: 12 pages · 4,800 assets · 3\.2 MB · 0:05$/);
  });

  it('says a snapshot read after the timeline’s last day was read after it, and one read before, before', () => {
    const ahead: TimelineInfo = { ...LIVE_INFO, readTime: '2026-10-12T08:00:00Z' };
    const after = model(`snapshot=${REF}`, ahead);
    expect(after.ownBeyond).toBe('after');
    expect(readout({ ...quiet, model: after }).text).toBe(
      "The snapshot was read after the latest day on this timeline: later than this computer's clock says it is now.",
    );
    const old: TimelineInfo = { ...ahead, readTime: '2026-08-01T08:00:00Z' };
    const before = model(`snapshot=${REF}`, old);
    expect(before.ownBeyond).toBe('before');
    expect(readout({ ...quiet, model: before }).text).toBe(
      'The snapshot was read before the days on this timeline.',
    );
    expect(model(`snapshot=${REF}`, { ...ahead, readTime: '2026-10-07T09:12:00Z' }).ownBeyond).toBeNull();
  });

  it('says an extra tick that was not drawn could not be drawn, or is no longer stored, once the pipeline answered', () => {
    const tick = extra('2026-10-05T14:30:00Z');
    const hash = `snapshot=demo:S&tick=${tick.id}`;
    // Not drawn yet: being drawn.
    const waiting = model(hash, HISTORY, { extras: [tick], pending: true });
    expect(readout({ ...quiet, model: waiting }).text).toBe('Drawing export 2026-10-05 14:30…');
    // The pipeline answered with the snapshot itself: the export is gone (deleted in another tab).
    const gone = model(hash, HISTORY, { extras: [tick] });
    expect(readout({ ...quiet, model: gone, settled: true }).text).toBe(
      'export 2026-10-05 14:30 is no longer stored in this browser; the snapshot itself is shown.',
    );
    // The pipeline failed (a damaged copy): why.
    expect(
      readout({ ...quiet, model: gone, settled: true, drawError: 'The snapshot is damaged.' }).text,
    ).toBe('export 2026-10-05 14:30 could not be drawn: The snapshot is damaged.');
    // Drawn: as before.
    const drawn = model(hash, HISTORY, { extras: [tick], tick: tick.id });
    expect(readout({ ...quiet, model: drawn, settled: true }).text).toBe(
      'export 2026-10-05 14:30 · extra tick',
    );
  });

  it('says why an extra tick read before the timeline’s first day is not on it', () => {
    const older = extra('2026-08-01T09:00:00Z');
    const view = model(`snapshot=demo:S&tick=${older.id}`, HISTORY, { extras: [older] });
    expect(view.outsideExtra).toEqual(older);
    expect(view.ticks.some((tick) => tick.extra !== undefined)).toBe(false);
    expect(readout({ ...quiet, model: view }).text).toBe(
      'export 2026-08-01 09:00 was read before the first day of this timeline of the last 35 days; the snapshot itself is shown.',
    );
  });

  it('says why a day could not be drawn', () => {
    const view = model('snapshot=demo:S&tick=2026-09-20', HISTORY);
    expect(readout({ ...quiet, model: view, settled: true, drawError: 'Out of memory.' }).text).toBe(
      'Sunday, 20 September 2026 could not be drawn: Out of memory.',
    );
    expect(readout({ ...quiet, model: view }).text).toBe('Drawing Sunday, 20 September 2026…');
  });
});
