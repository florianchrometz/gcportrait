// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * The tick math (skill cai-ingestion §5) with a fixed `today`: 35 ticks ending today at 00:00 UTC, the latest of a
 * live scope at "now", across month, year and leap-day boundaries; days and read times; labels in the viewer's local
 * date (a fixed locale and time zone here).
 */
import { describe, expect, it, vi } from 'vitest';

import { isDay } from '@gcportrait/model';

import {
  addDays,
  dayOfReadTime,
  dayReadTime,
  historyTicks,
  indexOfDay,
  localMinute,
  tickLabel,
  tickTitle,
  timelineTicks,
  utcDayOf,
} from './ticks';

const TODAY = '2026-10-10';

describe('timelineTicks', () => {
  it('is today at 00:00 UTC and the 34 days before it, oldest first', () => {
    const ticks = timelineTicks(TODAY);
    expect(ticks).toHaveLength(35);
    expect(ticks[0]).toEqual({
      index: 0,
      day: '2026-09-06',
      readTime: '2026-09-06T00:00:00Z',
      at: Date.parse('2026-09-06T00:00:00Z'),
    });
    expect(ticks[34]).toEqual({
      index: 34,
      day: TODAY,
      readTime: '2026-10-10T00:00:00Z',
      at: Date.parse('2026-10-10T00:00:00Z'),
    });
    const days = ticks.map((tick) => tick.day);
    expect(new Set(days).size).toBe(35);
    expect([...days].sort()).toEqual(days);
    for (const tick of ticks) expect(tick.readTime).toBe(`${tick.day}T00:00:00Z`);
  });

  it('reads the latest tick of a live scope at "now", never before its day started', () => {
    const now = Date.parse('2026-10-10T13:45:00Z');
    const ticks = timelineTicks(TODAY, now);
    expect(ticks[34]).toEqual({ index: 34, day: TODAY, readTime: null, at: now });
    expect(ticks[33]?.readTime).toBe('2026-10-09T00:00:00Z');
    // A clock behind the day (a caller's mistake) still labels the tick with its own day.
    expect(timelineTicks(TODAY, Date.parse('2026-10-09T23:00:00Z'))[34]?.at).toBe(
      Date.parse(`${TODAY}T00:00:00Z`),
    );
  });

  it('crosses month, year and leap-day boundaries by calendar days', () => {
    expect(timelineTicks('2026-01-10')[0]?.day).toBe('2025-12-07');
    expect(timelineTicks('2026-03-01').map((tick) => tick.day)).toContain('2026-02-28');
    expect(timelineTicks('2026-03-01').map((tick) => tick.day)).not.toContain('2026-02-29');
    expect(timelineTicks('2028-03-01').map((tick) => tick.day)).toContain('2028-02-29');
    expect(timelineTicks('2028-03-01')[0]?.day).toBe('2028-01-27');
  });
});

describe('days', () => {
  it('knows a real calendar day', () => {
    expect(isDay('2026-10-08')).toBe(true);
    expect(isDay('2028-02-29')).toBe(true);
    expect(isDay('2026-02-29')).toBe(false);
    expect(isDay('2026-13-01')).toBe(false);
    expect(isDay('2026-10-8')).toBe(false);
    expect(isDay('2026-10-08T00:00:00Z')).toBe(false);
    expect(isDay(20261008)).toBe(false);
  });

  it('adds days, and reads the UTC day of an instant or a read time', () => {
    expect(addDays('2026-10-08', -34)).toBe('2026-09-04');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(utcDayOf(Date.parse('2026-10-08T23:59:59.999Z'))).toBe('2026-10-08');
    expect(dayReadTime('2026-10-08')).toBe('2026-10-08T00:00:00Z');
    expect(dayOfReadTime('2026-10-10T11:59:58.123456Z')).toBe('2026-10-10');
    expect(dayOfReadTime('2026-10-10T01:00:00+02:00')).toBe('2026-10-09');
    expect(dayOfReadTime('not a time')).toBeNull();
  });

  it('builds a stored history’s ticks from its days, and finds a day', () => {
    const ticks = historyTicks(['2026-10-07', '2026-10-08']);
    expect(ticks).toEqual([
      {
        index: 0,
        day: '2026-10-07',
        readTime: '2026-10-07T00:00:00Z',
        at: Date.parse('2026-10-07T00:00:00Z'),
      },
      {
        index: 1,
        day: '2026-10-08',
        readTime: '2026-10-08T00:00:00Z',
        at: Date.parse('2026-10-08T00:00:00Z'),
      },
    ]);
    expect(indexOfDay(ticks, '2026-10-08')).toBe(1);
    expect(indexOfDay(ticks, '2026-10-09')).toBe(-1);
    expect(indexOfDay(ticks, null)).toBe(-1);
  });
});

describe('labels', () => {
  const tick = timelineTicks('2026-10-08')[34];
  if (tick === undefined) throw new Error('no tick');

  it('are the viewer’s local date of the tick’s instant', () => {
    expect(tickLabel(tick, { locale: 'en-GB', timeZone: 'UTC' })).toBe('8 Oct');
    // ICU versions differ on the comma after the weekday.
    expect(tickTitle(tick, { locale: 'en-GB', timeZone: 'UTC' })).toMatch(/^Thursday,? 8 October 2026$/);
    // West of Greenwich, 00:00 UTC is still the evening before.
    expect(tickLabel(tick, { locale: 'en-GB', timeZone: 'America/Los_Angeles' })).toBe('7 Oct');
    expect(tickLabel(tick, { locale: 'en-US', timeZone: 'Asia/Tokyo' })).toBe('Oct 8');
    expect(tickLabel(tick, { locale: 'de-DE', timeZone: 'Europe/Berlin' })).toBe('8. Okt.');
  });

  it('label the latest live tick with the local date of now', () => {
    const latest = timelineTicks('2026-10-10', Date.parse('2026-10-10T23:30:00Z'))[34];
    if (latest === undefined) throw new Error('no tick');
    expect(tickLabel(latest, { locale: 'en-GB', timeZone: 'UTC' })).toBe('10 Oct');
    expect(tickLabel(latest, { locale: 'en-GB', timeZone: 'Europe/Berlin' })).toBe('11 Oct');
  });

  // This changes the process's time zone (and restores it): safe because vitest's default `forks` pool runs each test
  // file in a process of its own, so no other file's dates see it.
  it('follow the viewer’s time zone when it changes while the page is open (the formatters are kept)', async () => {
    try {
      vi.stubEnv('TZ', 'UTC');
      expect(tickLabel(tick, { locale: 'en-GB' })).toBe('8 Oct');
      await Promise.resolve();
      vi.stubEnv('TZ', 'America/Los_Angeles');
      expect(tickLabel(tick, { locale: 'en-GB' })).toBe('7 Oct');
      await Promise.resolve();
      vi.stubEnv('TZ', 'UTC');
      expect(tickLabel(tick, { locale: 'en-GB' })).toBe('8 Oct');
    } finally {
      await Promise.resolve();
      vi.unstubAllEnvs();
    }
  });
});

describe('local minutes', () => {
  const instant = Date.parse('2026-10-05T00:00:12Z');

  it('keeps numeric en-GB fields, midnight and optional seconds regardless of locale', () => {
    expect(localMinute(instant, { timeZone: 'UTC', locale: 'ar-EG' })).toBe('2026-10-05 00:00');
    expect(localMinute(instant, { timeZone: 'UTC', locale: 'not_a_locale' }, true)).toBe(
      '2026-10-05 00:00:12',
    );
    expect(localMinute(instant, { timeZone: 'America/Los_Angeles' })).toBe('2026-10-04 17:00');
    expect(localMinute(Date.parse('2026-03-29T00:30:00Z'), { timeZone: 'Europe/Berlin' })).toBe(
      '2026-03-29 01:30',
    );
    expect(localMinute(Date.parse('2026-03-29T01:30:00Z'), { timeZone: 'Europe/Berlin' })).toBe(
      '2026-03-29 03:30',
    );
  });

  it('reuses the numeric formatter across seconds and locale choices, but separates time zones', async () => {
    vi.resetModules();
    const fresh = await import('./ticks');
    const constructor = vi.spyOn(Intl, 'DateTimeFormat');
    try {
      expect(fresh.localMinute(instant, { timeZone: 'UTC' })).toBe('2026-10-05 00:00');
      expect(fresh.localMinute(instant, { timeZone: 'UTC', locale: 'ar-EG' }, true)).toBe(
        '2026-10-05 00:00:12',
      );
      expect(fresh.localMinute(instant, { timeZone: 'Europe/Berlin' })).toBe('2026-10-05 02:00');
      expect(fresh.localMinute(instant, { timeZone: 'UTC' })).toBe('2026-10-05 00:00');
      expect(constructor).toHaveBeenCalledTimes(2);
    } finally {
      constructor.mockRestore();
      vi.resetModules();
    }
  });

  it('refreshes the default zone each turn while reusing formatters for previously seen zones', async () => {
    vi.resetModules();
    const fresh = await import('./ticks');
    const constructor = vi.spyOn(Intl, 'DateTimeFormat');
    try {
      vi.stubEnv('TZ', 'UTC');
      expect(fresh.localMinute(instant)).toBe('2026-10-05 00:00');
      expect(fresh.localMinute(instant, {}, true)).toBe('2026-10-05 00:00:12');
      expect(constructor).toHaveBeenCalledTimes(2);
      await Promise.resolve();
      vi.stubEnv('TZ', 'America/Los_Angeles');
      expect(fresh.localMinute(instant)).toBe('2026-10-04 17:00');
      expect(constructor).toHaveBeenCalledTimes(4);
      await Promise.resolve();
      vi.stubEnv('TZ', 'UTC');
      expect(fresh.localMinute(instant)).toBe('2026-10-05 00:00');
      expect(constructor).toHaveBeenCalledTimes(5);
    } finally {
      await Promise.resolve();
      constructor.mockRestore();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('propagates invalid time zones and instants as RangeErrors', () => {
    expect(() => localMinute(instant, { timeZone: 'not/a/zone' })).toThrow(RangeError);
    expect(() => localMinute(Number.NaN, { timeZone: 'UTC' })).toThrow(RangeError);
    expect(() => localMinute(Number.POSITIVE_INFINITY, { timeZone: 'UTC' })).toThrow(RangeError);
    expect(localMinute(instant, { timeZone: 'UTC' })).toBe('2026-10-05 00:00');
  });
});
