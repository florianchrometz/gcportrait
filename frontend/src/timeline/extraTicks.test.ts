// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Extra ticks (extraTicks.ts): their ids; which stored snapshots are extra ticks of a timeline (exports
 * and pulls of its scope, never the snapshot itself or a copy at its own read time, never another scope's or a demo);
 * duplicates read in the same second as one tick showing the copy stored last (the same one the data worker draws);
 * ordering among the day ticks (an extra at a day's 00:00 after that day); a read time in the future clamped to
 * `now` with a warning; their labels; the timeline model with them (positions, states, drawing, stepping, playback
 * only with `playExtras`) and its words; and the store binding that keeps the `timeline` slice's extra ticks.
 */
import { decodeViewSpec, type ViewSpec } from '@gcportrait/model';
import { describe, expect, it, vi } from 'vitest';

import { createAppStore } from '../state';
import type { SnapshotMeta } from '../storage/db';
import {
  bindExtraTicks,
  extraDayLabel,
  extraTickId,
  extraTickLabel,
  extraTicksFor,
  isExtraTickId,
  localMinute,
  mergeTicks,
  ownerOf,
  pickExtra,
  readTimeSourceOf,
  withExtraLabel,
  type ExtraCandidate,
  type TimelineOwner,
} from './extraTicks';
import { stepTarget, tickToDraw, timelineModel } from './model';
import type { TimelineSlice } from './state';
import {
  APP_NOW as NOW,
  historyInfo,
  HISTORY_TODAY as TODAY,
  LIVE_INFO,
  timelineSlice,
} from './testing/fixtures';
import { historyTicks, timelineTicks } from './ticks';
import type { TimelineInfo } from './types';
import { markerTitle, readout, valueText } from './words';

const SCOPE = LIVE_INFO.scope;
const SCOPE_PATH = LIVE_INFO.scopePath;
const HISTORY = historyInfo(TODAY, { scopePath: SCOPE_PATH, readTime: `${TODAY}T00:00:00Z` });
const DAYS = HISTORY.days;

/** `value` without `key` (a record stored before a field existed). */
function without<T extends object, K extends keyof T>(value: T, key: K): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key)) as Omit<T, K>;
}
const OWNER: TimelineOwner = { ref: 'demo:M', scopePath: SCOPE_PATH, readTime: `${TODAY}T00:00:00Z` };
const UTC = { locale: 'en-GB', timeZone: 'UTC' } as const;

const EXPORT = '01J0000000000000000000000E';
const COPY = '01J0000000000000000000000F';
const PULL = '01J0000000000000000000000P';

function candidate(id: string, meta: Partial<SnapshotMeta> = {}): ExtraCandidate {
  return {
    id,
    meta: {
      scope: SCOPE,
      readTime: '2026-10-05T14:30:12.345678Z',
      source: 'export',
      savedAt: '2026-10-10T10:00:00.000Z',
      assetCount: 12,
      bytes: 3_400,
      detail: 'export.json',
      readTimeSource: 'export-sidecar',
      ...meta,
    },
  };
}

function spec(hash: string): ViewSpec {
  return decodeViewSpec(hash);
}

function slice(extra: Partial<TimelineSlice> = {}, info: TimelineInfo = HISTORY): TimelineSlice {
  return timelineSlice('demo:M', info, extra);
}

describe('extra tick ids', () => {
  it('are the read time to the second in UTC, never a day', () => {
    expect(extraTickId('2026-10-05T14:30:12.345678Z')).toBe('2026-10-05T14:30:12Z');
    expect(extraTickId('2026-10-05T16:30:12+02:00')).toBe('2026-10-05T14:30:12Z');
    expect(extraTickId('not a time')).toBeNull();
    expect(isExtraTickId('2026-10-05T14:30:12Z')).toBe(true);
    for (const value of ['2026-10-05', '2026-10-05T14:30:12.000Z', '2026-02-30T00:00:00Z', 7])
      expect(isExtraTickId(value)).toBe(false);
  });

  it('say where the read time came from, older records by their estimate flag', () => {
    expect(readTimeSourceOf(candidate(EXPORT).meta)).toBe('export-sidecar');
    expect(readTimeSourceOf(candidate(EXPORT, { readTimeSource: 'user' }).meta)).toBe('user');
    expect(readTimeSourceOf(candidate(EXPORT, { readTimeSource: 'estimated-max-update-time' }).meta)).toBe(
      'estimated',
    );
    // An older record has no readTimeSource: its estimate flag, or its source, says.
    const older = without(candidate(EXPORT).meta, 'readTimeSource');
    expect(readTimeSourceOf({ ...older, estimatedReadTime: true })).toBe('estimated');
    expect(readTimeSourceOf(older)).toBe('unknown');
    expect(readTimeSourceOf({ ...older, source: 'api' })).toBe('api');
  });
});

describe('which stored snapshots are extra ticks', () => {
  it('takes the exports and pulls of the timeline’s scope, but not the snapshot itself, a demo or another scope', () => {
    const ticks = extraTicksFor(
      [
        candidate(EXPORT),
        candidate(PULL, { source: 'api', readTime: '2026-09-20T08:00:00Z', readTimeSource: 'api' }),
        candidate('demo:S', { source: 'demo', readTime: '2026-09-21T00:00:00Z' }),
        candidate('01J0000000000000000000000X', {
          scope: { kind: 'organization', id: '30000000002' },
          readTime: '2026-09-22T00:00:00Z',
        }),
        candidate('01J0000000000000000000000Y', {
          scope: { kind: 'project', id: '30000000001' },
          readTime: '2026-09-23T00:00:00Z',
        }),
      ],
      OWNER,
      NOW,
    );
    expect(ticks.map((tick) => [tick.id, tick.ref, tick.source])).toEqual([
      ['2026-09-20T08:00:00Z', PULL, 'api'],
      ['2026-10-05T14:30:12Z', EXPORT, 'export'],
    ]);
    const live = { ...OWNER, ref: EXPORT, readTime: '2026-10-05T14:30:12.345678Z' };
    expect(extraTicksFor([candidate(EXPORT), candidate(PULL, { source: 'api' })], live, NOW)).toEqual([]);
  });

  it('shows copies read in the same second as one tick, the one stored last, which the worker draws too', () => {
    const older = candidate(EXPORT, { savedAt: '2026-10-09T10:00:00.000Z', bytes: 1 });
    const newer = candidate(COPY, { savedAt: '2026-10-10T10:00:00.000Z', readTime: '2026-10-05T14:30:12Z' });
    const [tick, ...rest] = extraTicksFor([older, newer], OWNER, NOW);
    expect(rest).toEqual([]);
    expect(tick).toMatchObject({ id: '2026-10-05T14:30:12Z', ref: COPY, copies: 2, bytes: 3_400 });
    expect(pickExtra([older, newer], OWNER, '2026-10-05T14:30:12Z')?.id).toBe(COPY);
    expect(pickExtra([older, newer], OWNER, '2026-10-05T14:30:13Z')).toBeNull();
    // Stored in the same instant: the greater id, so the choice never depends on the order of the listing.
    const tie = candidate(COPY, { savedAt: older.meta.savedAt });
    expect(pickExtra([tie, older], OWNER, '2026-10-05T14:30:12Z')?.id).toBe(COPY);
    expect(pickExtra([older, tie], OWNER, '2026-10-05T14:30:12Z')?.id).toBe(COPY);
  });

  it('drops a copy read at the snapshot’s own read time: the timeline shows the snapshot itself there', () => {
    const own = candidate(EXPORT, { readTime: `${TODAY}T00:00:00Z` });
    expect(extraTicksFor([own], OWNER, NOW)).toEqual([]);
    expect(pickExtra([own], OWNER, `${TODAY}T00:00:00Z`)).toBeNull();
  });

  it('places a read time later than now at now, and says so', () => {
    const [tick] = extraTicksFor([candidate(EXPORT, { readTime: '2026-11-01T14:30:00Z' })], OWNER, NOW);
    expect(tick).toMatchObject({ id: '2026-11-01T14:30:00Z', at: NOW, future: true });
    expect(tick?.warning).toBe(
      "The export read 2026-11-01 14:30 UTC has a read time later than this browser's clock, so the timeline " +
        'shows it at the present.',
    );
    const [past] = extraTicksFor([candidate(EXPORT)], OWNER, NOW);
    expect(past?.future).toBe(false);
    expect(past?.warning).toBeUndefined();
    expect(past?.at).toBe(Date.parse('2026-10-05T14:30:12Z'));
  });
});

describe('merging extra ticks with the days', () => {
  const extras = extraTicksFor(
    [
      candidate(EXPORT),
      candidate(PULL, { source: 'api', readTime: '2026-09-20T00:00:00Z' }),
      candidate(COPY, { readTime: '2026-11-01T00:00:00Z' }),
      candidate('01J0000000000000000000000Q', { readTime: '2026-08-01T09:00:00Z' }),
    ],
    OWNER,
    NOW,
  );

  it('orders them by the instant they show, a day before an extra tick at its 00:00, and numbers them again', () => {
    const merged = mergeTicks(historyTicks(DAYS), extras);
    expect(merged).toHaveLength(38);
    expect(merged.map((tick) => tick.index)).toEqual(merged.map((_, index) => index));
    const ids = merged.map((tick) => tick.day);
    // Older than every day: not on the timeline. At a day's 00:00: right after the day. Between days: in between.
    // In the future: at now, after the last day.
    expect(ids).not.toContain('2026-08-01T09:00:00Z');
    expect(ids[0]).toBe(DAYS[0]);
    expect(ids.indexOf('2026-09-20T00:00:00Z')).toBe(ids.indexOf('2026-09-20') + 1);
    expect(ids.indexOf('2026-10-05T14:30:12Z')).toBe(ids.indexOf('2026-10-05') + 1);
    expect(ids.indexOf('2026-10-06')).toBe(ids.indexOf('2026-10-05T14:30:12Z') + 1);
    expect(ids.at(-1)).toBe('2026-11-01T00:00:00Z');
    expect(merged.at(-1)?.extra?.future).toBe(true);
    expect(merged.filter((tick) => tick.extra !== undefined)).toHaveLength(3);
  });

  it('keeps an extra tick read at the first day’s 00:00, and leaves out one read a second before', () => {
    const days = historyTicks(DAYS);
    const [first] = days;
    const [model] = extras;
    if (first === undefined || model === undefined) throw new Error('no days or no extra tick');
    const at = (readTime: string) => ({ ...model, id: readTime, readTime, at: Date.parse(readTime) });
    const midnight = at(`${first.day}T00:00:00Z`);
    const before = at(
      new Date(Date.parse(`${first.day}T00:00:00Z`) - 1000).toISOString().replace('.000', ''),
    );
    const merged = mergeTicks(days, [before, midnight]);
    expect(merged.map((tick) => tick.day).slice(0, 2)).toEqual([first.day, midnight.id]);
    expect(merged.some((tick) => tick.day === before.id)).toBe(false);
    expect(mergeTicks(days, [before])).toBe(days);
  });

  it('puts an extra tick of today before a live scope’s latest day read at now', () => {
    const today = '2026-10-10';
    const now = Date.parse('2026-10-10T18:00:00Z');
    const live = { ...OWNER, ref: '01J0000000000000000000000A', readTime: '2026-10-07T09:12:00Z' };
    const [noon] = extraTicksFor(
      [candidate(PULL, { source: 'api', readTime: '2026-10-10T12:00:00Z' })],
      live,
      now,
    );
    if (noon === undefined) throw new Error('no extra tick');
    const merged = mergeTicks(timelineTicks(today, now), [noon]);
    expect(merged.slice(-3).map((tick) => tick.day)).toEqual(['2026-10-09', '2026-10-10T12:00:00Z', today]);
  });

  it('leaves the days alone without extra ticks', () => {
    const days = historyTicks(DAYS);
    expect(mergeTicks(days, [])).toBe(days);
  });
});

describe('labels', () => {
  it('constructs one formatter for all extra markers and their collision checks', async () => {
    vi.resetModules();
    const fresh = await import('./extraTicks');
    expect(fresh.localMinute).toBe((await import('./ticks')).localMinute);
    const extras = extraTicksFor(
      Array.from({ length: 8 }, (_, index) =>
        candidate(`01J0000000000000000000000${String(index)}`, {
          readTime: `2026-10-05T14:3${String(index)}:12Z`,
        }),
      ),
      OWNER,
      NOW,
    );
    const constructor = vi.spyOn(Intl, 'DateTimeFormat');
    try {
      expect(extras.map((extra) => fresh.extraTickLabel(extra, extras, UTC))).toEqual(
        Array.from({ length: 8 }, (_, index) => `export 2026-10-05 14:3${String(index)}`),
      );
      expect(constructor).toHaveBeenCalledTimes(1);
    } finally {
      constructor.mockRestore();
      vi.resetModules();
    }
  });

  it('keeps seconds when distinct instants share a local minute across the DST fall-back', () => {
    const extras = extraTicksFor(
      [
        candidate(EXPORT, { readTime: '2026-10-25T00:30:12Z' }),
        candidate(PULL, { source: 'api', readTime: '2026-10-25T01:30:45Z' }),
      ],
      OWNER,
      Date.parse('2026-10-26T00:00:00Z'),
    );
    expect(extras.map((extra) => extraTickLabel(extra, extras, { timeZone: 'Europe/Berlin' }))).toEqual([
      'export 2026-10-25 02:30:12',
      'pull 2026-10-25 02:30:45',
    ]);
  });

  const [tick] = extraTicksFor([candidate(EXPORT)], OWNER, NOW);
  if (tick === undefined) throw new Error('no extra tick');

  it('name the source and the read time in the viewer’s local time', () => {
    expect(extraTickLabel(tick, [tick], UTC)).toBe('export 2026-10-05 14:30');
    expect(extraTickLabel(tick, [tick], { timeZone: 'Europe/Berlin' })).toBe('export 2026-10-05 16:30');
    expect(localMinute(Date.parse('2026-10-05T14:30:12Z'), UTC, true)).toBe('2026-10-05 14:30:12');
  });

  it('say “pull”, “(estimated)”, and the seconds when two share a minute', () => {
    const [pull, other] = extraTicksFor(
      [
        candidate(PULL, { source: 'api', readTime: '2026-10-05T14:30:00Z', readTimeSource: 'api' }),
        candidate(COPY, { readTime: '2026-10-05T14:30:45Z', readTimeSource: 'estimated-max-update-time' }),
      ],
      OWNER,
      NOW,
    );
    if (pull === undefined || other === undefined) throw new Error('no extra ticks');
    expect(extraTickLabel(pull, [pull, other], UTC)).toBe('pull 2026-10-05 14:30:00');
    expect(extraTickLabel(other, [pull, other], UTC)).toBe('export 2026-10-05 14:30:45 (estimated)');
    expect(extraTickLabel(other, [other], UTC)).toBe('export 2026-10-05 14:30 (estimated)');
  });

  it('name a day compared with when it is one of the timeline’s extra ticks, for the diff wording', () => {
    expect(extraDayLabel(tick.id, [tick], UTC)).toBe('export 2026-10-05 14:30');
    expect(extraDayLabel('2026-10-05', [tick], UTC)).toBeUndefined();
    expect(extraDayLabel(tick.id, null, UTC)).toBeUndefined();
    expect(extraDayLabel('2026-10-06T00:00:00Z', [tick], UTC)).toBeUndefined();
    const day = { tick: tick.id, readTime: tick.readTime };
    expect(withExtraLabel(day, [tick], UTC)).toEqual({ ...day, label: 'export 2026-10-05 14:30' });
    const plain = { tick: '2026-10-05', readTime: '2026-10-05T00:00:00Z' };
    expect(withExtraLabel(plain, [tick], UTC)).toBe(plain);
  });
});

describe('the timeline with extra ticks', () => {
  const extras = extraTicksFor(
    [candidate(EXPORT), candidate(PULL, { source: 'api', readTime: '2026-09-20T08:00:00Z' })],
    OWNER,
    NOW,
  );
  const timeline = slice({ extras });
  const EXTRA = '2026-10-05T14:30:12Z';

  it('draws an extra tick at once, on a history and on a live scope alike', () => {
    expect(tickToDraw(spec(`snapshot=demo:M&tick=${EXTRA}`), timeline, null)).toBe(EXTRA);
    const ref = '01J0000000000000000000000A';
    const liveSlice = timelineSlice(ref, LIVE_INFO, { extras });
    expect(tickToDraw(spec(`snapshot=${ref}&tick=${EXTRA}`), liveSlice, null)).toBe(EXTRA);
    // An extra tick this browser does not keep is not on the timeline: the snapshot itself is drawn.
    expect(tickToDraw(spec('snapshot=demo:M&tick=2026-10-05T14:31:00Z'), timeline, null)).toBeUndefined();
  });

  it('puts the view on an extra tick, ready and selectable, current once drawn', () => {
    const model = timelineModel({
      spec: spec(`snapshot=demo:M&tick=${EXTRA}`),
      timeline,
      onScreen: { ref: 'demo:M', tick: EXTRA },
      pending: false,
    });
    if (model === null) throw new Error('no model');
    expect(model.ticks).toHaveLength(37);
    const index = model.ticks.findIndex((tick) => tick.day === EXTRA);
    expect(model.position).toBe(index);
    expect(model.drawn).toBe(index);
    expect(model.states[index]).toBe('current');
    expect(model.own).toBe(36);
    const pull = model.ticks.findIndex((tick) => tick.day === '2026-09-20T08:00:00Z');
    expect(model.states[pull]).toBe('cached');
    expect(valueText(model, index, UTC)).toBe(
      "export 2026-10-05 14:30, extra tick, read time from the export's operation.json, on screen",
    );
    expect(markerTitle(model, pull, UTC)).toBe('pull 2026-09-20 08:00: ready');
    const said = readout({ model, progress: null, failure: null, blocked: null, labels: UTC });
    expect(said.text).toBe('export 2026-10-05 14:30 · extra tick');
    expect(said.detail).toBe(
      "export 2026-10-05 14:30: an extra tick, read time from the export's operation.json.",
    );
    // While it is being drawn, its marker says so (the readout's words for it are words.test.ts's).
    const drawing = timelineModel({
      spec: spec(`snapshot=demo:M&tick=${EXTRA}`),
      timeline,
      onScreen: { ref: 'demo:M' },
      pending: true,
    });
    if (drawing === null) throw new Error('no model');
    expect(drawing.states[index]).toBe('loading');
  });

  it('waits for the extra ticks before it says a link’s extra tick is missing, and draws it meanwhile', () => {
    const unknown = slice({ extras: null });
    const view = spec(`snapshot=demo:M&tick=${EXTRA}`);
    expect(tickToDraw(view, unknown, null)).toBe(EXTRA);
    expect(timelineModel({ spec: view, timeline: unknown, onScreen: null, pending: true })).toBeNull();
    // A day tick does not wait for them.
    const day = timelineModel({
      spec: spec('snapshot=demo:M&tick=2026-10-01'),
      timeline: unknown,
      onScreen: { ref: 'demo:M', tick: '2026-10-01' },
      pending: false,
    });
    expect(day?.ticks).toHaveLength(35);
    expect(day?.states[day.position ?? -1]).toBe('current');
    // Stepping goes over the days alone meanwhile, and waits on an extra tick.
    expect(stepTarget(spec('snapshot=demo:M&tick=2026-10-06'), unknown, -1)).toEqual({ day: '2026-10-05' });
    expect(stepTarget(view, unknown, -1)).toEqual({ refusal: 'The timeline is not ready yet.' });
  });

  it('leaves the extra ticks out of playback unless the person asks for them', () => {
    const input = { spec: spec('snapshot=demo:M'), onScreen: { ref: 'demo:M' }, pending: false } as const;
    const without = timelineModel({ ...input, timeline });
    const withExtras = timelineModel({ ...input, timeline: slice({ extras, playExtras: true }) });
    const extraIndexes = (without?.ticks ?? []).flatMap((tick, index) => (tick.extra ? [index] : []));
    expect(extraIndexes).toHaveLength(2);
    for (const index of extraIndexes) {
      expect(without?.available[index]).toBe(false);
      expect(without?.states[index]).toBe('cached');
      expect(withExtras?.available[index]).toBe(true);
    }
    expect(without?.available.filter(Boolean)).toHaveLength(35);
  });

  it('steps through extra ticks like days', () => {
    expect(stepTarget(spec('snapshot=demo:M&tick=2026-10-06'), timeline, -1)).toEqual({ day: EXTRA });
    expect(stepTarget(spec(`snapshot=demo:M&tick=${EXTRA}`), timeline, -1)).toEqual({ day: '2026-10-05' });
    expect(stepTarget(spec(`snapshot=demo:M&tick=${EXTRA}`), timeline, 1)).toEqual({ day: '2026-10-06' });
  });

  it('says when a link names an extra tick this browser does not keep', () => {
    const model = timelineModel({
      spec: spec('snapshot=demo:M&tick=2026-10-05T14:31:00Z'),
      timeline,
      onScreen: { ref: 'demo:M' },
      pending: false,
    });
    if (model === null) throw new Error('no model');
    expect(model.outside).toBe('2026-10-05T14:31:00Z');
    expect(readout({ model, progress: null, failure: null, blocked: null }).text).toBe(
      'No export or pull of this scope read at 2026-10-05T14:31:00Z is kept in this browser; the snapshot itself ' +
        'is shown.',
    );
  });

  it('says a tick placed at the present is one', () => {
    const future = extraTicksFor([candidate(EXPORT, { readTime: '2026-11-01T14:30:00Z' })], OWNER, NOW);
    const model = timelineModel({
      spec: spec('snapshot=demo:M&tick=2026-11-01T14:30:00Z'),
      timeline: slice({ extras: future }),
      onScreen: { ref: 'demo:M', tick: '2026-11-01T14:30:00Z' },
      pending: false,
    });
    if (model === null) throw new Error('no model');
    const index = model.position ?? -1;
    expect(index).toBe(35);
    expect(valueText(model, index, UTC)).toMatch(/, placed at the present, on screen$/);
    const said = readout({ model, progress: null, failure: null, blocked: null, labels: UTC });
    expect(said.text).toBe('export 2026-11-01 14:30 · extra tick, shown at the present');
    expect(said.detail).toMatch(
      /later than this browser's clock, so the timeline shows it at the present\.$/,
    );
  });

  it('says how many copies were read in the same second', () => {
    const copies = extraTicksFor(
      [candidate(EXPORT), candidate(COPY, { savedAt: '2026-10-10T11:00:00.000Z' })],
      OWNER,
      NOW,
    );
    const model = timelineModel({
      spec: spec(`snapshot=demo:M&tick=${EXTRA}`),
      timeline: slice({ extras: copies }),
      onScreen: { ref: 'demo:M', tick: EXTRA },
      pending: false,
    });
    if (model === null) throw new Error('no model');
    const index = model.position ?? -1;
    expect(valueText(model, index, UTC)).toBe(
      "export 2026-10-05 14:30, extra tick, read time from the export's operation.json, 2 copies stored, on screen",
    );
    expect(readout({ model, progress: null, failure: null, blocked: null, labels: UTC }).detail).toMatch(
      / 2 copies are stored; the latest is shown\.$/,
    );
  });
});

describe('the timeline’s owner', () => {
  it('is the snapshot, its scope and its read time, once the timeline names them', () => {
    expect(ownerOf({ ref: 'demo:M', info: HISTORY })).toEqual(OWNER);
    expect(ownerOf({ ref: 'demo:M', info: null })).toBeNull();
    expect(ownerOf({ ref: '', info: HISTORY })).toBeNull();
    expect(ownerOf({ ref: 'demo:M', info: without(HISTORY, 'scopePath') })).toBeNull();
    // Without its read time, a history's own is its last day's 00:00 UTC.
    expect(ownerOf({ ref: 'demo:M', info: without(HISTORY, 'readTime') })?.readTime).toBe(
      `${TODAY}T00:00:00Z`,
    );
  });
});

describe('the store binding', () => {
  it('writes the view’s extra ticks once its timeline is known, again for another snapshot, and stops', () => {
    const store = createAppStore({ location: { pathname: '/diagram', hash: '#snapshot=demo:M' } });
    const candidates = [candidate(EXPORT)];
    const unbind = bindExtraTicks(store, candidates, () => NOW);
    // Unknown until the timeline is.
    expect(store.getState().timeline.extras).toBeNull();
    store.updateTimeline((current) => ({ ...current, info: HISTORY, today: TODAY }));
    expect(store.getState().timeline.extras?.map((tick) => tick.id)).toEqual(['2026-10-05T14:30:12Z']);
    // Another snapshot of the same scope: a timeline of its own, with the same extra tick once it is known.
    store.actions.setSnapshot('demo:S');
    expect(store.getState().timeline.extras).toBeNull();
    store.updateTimeline((current) => ({ ...current, info: HISTORY, today: TODAY }));
    expect(store.getState().timeline.extras).toHaveLength(1);
    unbind();
    store.actions.setSnapshot('demo:M');
    store.updateTimeline((current) => ({ ...current, info: HISTORY, today: TODAY }));
    expect(store.getState().timeline.extras).toBeNull();
  });

  it('knows there are none: a scope without stored exports or pulls, or a timeline that names no scope', () => {
    const store = createAppStore({ location: { pathname: '/diagram', hash: '#snapshot=demo:M' } });
    const unbind = bindExtraTicks(
      store,
      [candidate(EXPORT, { scope: { kind: 'project', id: 'p' } })],
      () => NOW,
    );
    store.updateTimeline((current) => ({ ...current, info: HISTORY, today: TODAY }));
    expect(store.getState().timeline.extras).toEqual([]);
    unbind();
    store.actions.setSnapshot('demo:S');
    const again = bindExtraTicks(store, [candidate(EXPORT)], () => NOW);
    store.updateTimeline((current) => ({ ...current, info: without(HISTORY, 'scopePath'), today: TODAY }));
    expect(store.getState().timeline.extras).toEqual([]);
    again();
  });

  it('follows the stored snapshots: the next listing binds again, and a deleted export is no tick any more', () => {
    const store = createAppStore({ location: { pathname: '/diagram', hash: '#snapshot=demo:M' } });
    store.updateTimeline((current) => ({ ...current, info: HISTORY, today: TODAY }));
    const first = bindExtraTicks(
      store,
      [candidate(EXPORT), candidate(PULL, { source: 'api', readTime: '2026-09-20T08:00:00Z' })],
      () => NOW,
    );
    expect(store.getState().timeline.extras).toHaveLength(2);
    first();
    const second = bindExtraTicks(store, [candidate(EXPORT)], () => NOW);
    expect(store.getState().timeline.extras).toHaveLength(1);
    const before = store.getState().timeline;
    second();
    // The same ticks again (a listing that changed elsewhere): the slice is left as it is.
    const same = bindExtraTicks(store, [candidate(EXPORT)], () => NOW);
    expect(store.getState().timeline).toBe(before);
    same();
    const after = bindExtraTicks(store, [], () => NOW);
    expect(store.getState().timeline.extras).toEqual([]);
    after();
  });

  it('keeps the choice to play extra ticks when the snapshot changes, as it keeps the interval', () => {
    const store = createAppStore({ location: { pathname: '/diagram', hash: '#snapshot=demo:M' } });
    store.updateTimeline((current) => ({ ...current, playExtras: true }));
    store.actions.setSnapshot('demo:S');
    expect(store.getState().timeline.ref).toBe('demo:S');
    expect(store.getState().timeline.playExtras).toBe(true);
  });
});
