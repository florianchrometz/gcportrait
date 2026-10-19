// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * The timeline's model (model.ts): the day the pipeline draws for a view (`tickToDraw`), the bar's positions and
 * marker states for a stored history and a live scope, the steps of `[` and `]` with their refusals, and the hash
 * form of the snapshot's own day (no tick).
 */
import { decodeViewSpec, type ViewSpec } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { dayAt, stepTarget, tickToDraw, timelineModel, withTick } from './model';
import {
  APP_TODAY,
  historyInfo,
  HISTORY_TODAY,
  LIVE_INFO as LIVE,
  timelineSlice as slice,
} from './testing/fixtures';

const HISTORY = historyInfo();

function spec(hash: string): ViewSpec {
  return decodeViewSpec(hash);
}

describe('tickToDraw', () => {
  it('draws nothing but the snapshot without a tick', () => {
    expect(tickToDraw(spec('snapshot=demo:M'), slice('demo:M', HISTORY), null)).toBeUndefined();
  });

  it('asks for the view’s tick as it is before the timeline is known', () => {
    expect(tickToDraw(spec('snapshot=demo:M&tick=2026-09-20'), slice('demo:M', null), null)).toBe(
      '2026-09-20',
    );
    expect(tickToDraw(spec('snapshot=demo:M&tick=2026-09-20'), slice('demo:S', HISTORY), null)).toBe(
      '2026-09-20',
    );
  });

  it('draws any day of a history at once, its last day as the snapshot itself, and no day it lacks', () => {
    const timeline = slice('demo:M', HISTORY);
    expect(tickToDraw(spec('snapshot=demo:M&tick=2026-09-20'), timeline, null)).toBe('2026-09-20');
    expect(tickToDraw(spec(`snapshot=demo:M&tick=${HISTORY_TODAY}`), timeline, null)).toBeUndefined();
    expect(tickToDraw(spec('snapshot=demo:M&tick=2026-08-01'), timeline, null)).toBeUndefined();
  });

  it('draws a live day once it is cached, and keeps the day on screen until then', () => {
    const view = spec('snapshot=01J0000000000000000000000A&tick=2026-10-01');
    const ref = view.snapshot;
    const waiting = slice(ref, LIVE, { status: { '2026-10-01': 'loading' } });
    expect(tickToDraw(view, waiting, null)).toBeUndefined();
    expect(tickToDraw(view, waiting, { ref, tick: '2026-09-30' })).toBe('2026-09-30');
    expect(tickToDraw(view, waiting, { ref: 'demo:M', tick: '2026-09-30' })).toBeUndefined();
    expect(tickToDraw(view, slice(ref, LIVE, { status: { '2026-10-01': 'cached' } }), null)).toBe(
      '2026-10-01',
    );
    // The snapshot's own day is the snapshot; a day before the 35 days is not on the timeline.
    expect(tickToDraw(spec(`snapshot=${ref}&tick=2026-10-07`), waiting, null)).toBeUndefined();
    expect(tickToDraw(spec(`snapshot=${ref}&tick=2026-09-01`), waiting, null)).toBeUndefined();
  });
});

describe('timelineModel', () => {
  it('waits for the timeline', () => {
    expect(
      timelineModel({
        spec: spec('snapshot=demo:M'),
        timeline: slice('demo:M', null),
        onScreen: null,
        pending: false,
      }),
    ).toBeNull();
  });

  it('puts a history’s view at the snapshot’s own day, every day ready, the drawn one current', () => {
    const model = timelineModel({
      spec: spec('snapshot=demo:M'),
      timeline: slice('demo:M', HISTORY),
      onScreen: { ref: 'demo:M' },
      pending: false,
    });
    expect(model?.ticks).toHaveLength(35);
    expect(model?.ticks[0]?.day).toBe('2026-09-04');
    expect(model?.own).toBe(34);
    expect(model?.position).toBe(34);
    expect(model?.drawn).toBe(34);
    expect(model?.outside).toBeNull();
    expect(model?.available.every(Boolean)).toBe(true);
    expect(model?.states.filter((state) => state === 'cached')).toHaveLength(34);
    expect(model?.states[34]).toBe('current');
  });

  it('shows the view’s day loading while the pipeline draws it', () => {
    const model = timelineModel({
      spec: spec('snapshot=demo:M&tick=2026-09-20'),
      timeline: slice('demo:M', HISTORY),
      onScreen: { ref: 'demo:M' },
      pending: true,
    });
    expect(model?.position).toBe(16);
    expect(model?.states[16]).toBe('loading');
    expect(model?.states[34]).toBe('current');
  });

  it('marks a live scope’s days unknown, loading, cached or failed, its own day ready', () => {
    const ref = '01J0000000000000000000000A';
    const model = timelineModel({
      spec: spec(`snapshot=${ref}&tick=2026-10-01`),
      timeline: slice(ref, LIVE, {
        status: { '2026-10-01': 'loading', '2026-10-02': 'cached', '2026-10-03': 'error' },
      }),
      onScreen: { ref },
      pending: false,
    });
    if (model === null) throw new Error('no model');
    expect(model.ticks[34]?.day).toBe(APP_TODAY);
    expect(model.ticks[34]?.readTime).toBeNull();
    const at = (day: string): string | undefined =>
      model.states[model.ticks.findIndex((tick) => tick.day === day)];
    expect(at('2026-10-07')).toBe('current');
    expect(at('2026-10-01')).toBe('loading');
    expect(at('2026-10-02')).toBe('cached');
    expect(at('2026-10-03')).toBe('error');
    expect(at('2026-10-04')).toBe('unknown');
    expect(model.available.filter(Boolean)).toHaveLength(2);
  });

  it('says when the view’s tick is not on the timeline', () => {
    const model = timelineModel({
      spec: spec('snapshot=demo:M&tick=2026-01-01'),
      timeline: slice('demo:M', HISTORY),
      onScreen: { ref: 'demo:M' },
      pending: false,
    });
    expect(model?.position).toBeNull();
    expect(model?.outside).toBe('2026-01-01');
  });
});

describe('stepTarget and withTick', () => {
  const timeline = slice('demo:M', HISTORY);

  it('steps one day, writing the snapshot’s own day as no tick', () => {
    expect(stepTarget(spec('snapshot=demo:M'), timeline, -1)).toEqual({ day: '2026-10-07' });
    expect(stepTarget(spec('snapshot=demo:M&tick=2026-10-07'), timeline, 1)).toEqual({ day: null });
    expect(stepTarget(spec('snapshot=demo:M&tick=2026-09-20'), timeline, 1)).toEqual({ day: '2026-09-21' });
    // From a day the timeline does not have, a step enters it at the near end.
    expect(stepTarget(spec('snapshot=demo:M&tick=2026-01-01'), timeline, 1)).toEqual({ day: '2026-09-04' });
    expect(stepTarget(spec('snapshot=demo:M&tick=2026-01-01'), timeline, -1)).toEqual({ day: null });
  });

  it('says why it cannot step', () => {
    const labels = { locale: 'en-GB', timeZone: 'UTC' };
    expect(stepTarget(spec(''), timeline, 1)).toEqual({
      refusal: 'Open a snapshot to move through its timeline.',
    });
    expect(stepTarget(spec('snapshot=demo:M'), slice('demo:M', null), 1)).toEqual({
      refusal: 'The timeline is not ready yet.',
    });
    expect(stepTarget(spec('snapshot=demo:M'), timeline, 1, labels)).toEqual({
      refusal: 'This is the latest day of the timeline (8 Oct).',
    });
    expect(stepTarget(spec('snapshot=demo:M&tick=2026-09-04'), timeline, -1, labels)).toEqual({
      refusal: 'This is the first day of the timeline (4 Sept).',
    });
  });

  it('writes a tick or drops it', () => {
    const view = spec('snapshot=demo:M&lens=networking&tick=2026-09-20');
    expect(withTick(view, '2026-09-21').tick).toBe('2026-09-21');
    expect('tick' in withTick(view, null)).toBe(false);
    expect(withTick(view, null).lens).toBe('networking');
  });

  it('turns a tick index into the day to write', () => {
    const model = {
      ticks:
        timelineModel({ spec: spec('snapshot=demo:M'), timeline, onScreen: null, pending: false })?.ticks ??
        [],
      own: 34,
    };
    expect(dayAt(model, 0)).toBe('2026-09-04');
    expect(dayAt(model, 34)).toBeNull();
    expect(dayAt(model, 35)).toBeUndefined();
  });
});
