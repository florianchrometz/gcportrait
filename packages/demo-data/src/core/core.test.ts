// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { hash32 } from './hash.js';
import { podSuffix, templateHash, ulid, uuid } from './ids.js';
import { CidrPool, HostPool, cidrContains, hostAt, intToIp, ipToInt } from './ip.js';
import { getPath, setPath, type JsonObject } from './json.js';
import { Rng, at } from './rng.js';
import { computeTimestamp, formatTick, parseTick, rfc3339Micros, weekday } from './time.js';

describe('rng', () => {
  it('draws the same, pinned sequence for the same seed (every demo name depends on it)', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const sequence = Array.from({ length: 50 }, () => a.next());
    expect(sequence.slice(0, 3)).toEqual([0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
    expect(Array.from({ length: 50 }, () => b.next())).toEqual(sequence);
  });

  it('differs between seeds', () => {
    expect(new Rng(1).next()).not.toBe(new Rng(2).next());
  });

  it('forks independently of how much the parent was used', () => {
    const fresh = new Rng(7).fork('web');
    const used = new Rng(7);
    for (let i = 0; i < 100; i++) used.next();
    expect(used.fork('web').next()).toBe(fresh.next());
    expect(new Rng(7).fork('gke').next()).not.toBe(new Rng(7).fork('web').next());
  });

  it('draws integers inside the inclusive range and hits both ends', () => {
    const rng = new Rng(3);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) {
      const n = rng.int(2, 5);
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
      seen.add(n);
    }
    expect([...seen].sort()).toEqual([2, 3, 4, 5]);
  });

  it('shuffles into a permutation', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(new Rng(9).shuffle(items).sort()).toEqual(items);
  });

  it('picks a member, and refuses to pick from an empty list', () => {
    const rng = new Rng(9);
    const items = ['a', 'b', 'c'];
    expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('at() refuses an index outside the list', () => {
    expect(at([1], 0)).toBe(1);
    expect(() => at([1], 1)).toThrow(RangeError);
  });
});

describe('hash', () => {
  it('hashes a string to a pinned value per seed (every demo name depends on it)', () => {
    expect(hash32('demo')).toBe(2043020345);
    expect(hash32('demo', 1)).toBe(2952701891);
  });
});

describe('ids', () => {
  it.each([
    ['a 19-digit number', (rng: Rng) => rng.digits(19), /^[1-9]\d{18}$/],
    ['hex digits', (rng: Rng) => rng.hex(8), /^[0-9a-f]{8}$/],
    ['a version 4 UUID', uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/],
    ['a pod name suffix', podSuffix, /^[bcdfghjklmnpqrstvwxz2456789]{5}$/],
    ['a pod template hash', templateHash, /^[bcdfghjklmnpqrstvwxz2456789]{10}$/],
    ['a ULID', (rng: Rng) => ulid(Date.UTC(2026, 9, 8), rng), /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/],
  ])('writes %s in its documented format', (_, generate, format) => {
    expect(generate(new Rng(11))).toMatch(format);
  });
});

describe('time', () => {
  it('formats a parsed tick back to the same day', () => {
    expect(formatTick(parseTick('2026-10-08'))).toBe('2026-10-08');
  });

  it.each(['2026-02-29', '2026-10-8'])('refuses the tick %s', (tick) => {
    expect(() => parseTick(tick)).toThrow(RangeError);
  });

  it('tells the weekday of a tick (Sunday 0)', () => {
    expect(weekday(parseTick('2026-10-08'))).toBe(4);
  });

  it.each([
    ['in summer, in daylight time', Date.UTC(2026, 6, 1, 12, 0, 0, 123), '2026-07-01T05:00:00.123-07:00'],
    ['in winter, in standard time', Date.UTC(2026, 0, 15, 12, 0, 0), '2026-01-15T04:00:00.000-08:00'],
  ])('writes a Compute timestamp %s in US Pacific time', (_, utc, timestamp) => {
    expect(computeTimestamp(utc)).toBe(timestamp);
  });

  // 2026-03-08 is the second Sunday of March: 10:00 UTC switches to daylight time. 2026-11-01 is the first Sunday
  // of November: 09:00 UTC switches back.
  it.each([
    ['2026-03-08 09:59', Date.UTC(2026, 2, 8, 9, 59), '-08:00'],
    ['2026-03-08 10:00', Date.UTC(2026, 2, 8, 10, 0), '-07:00'],
    ['2026-11-01 08:59', Date.UTC(2026, 10, 1, 8, 59), '-07:00'],
    ['2026-11-01 09:00', Date.UTC(2026, 10, 1, 9, 0), '-08:00'],
  ])('switches daylight saving on time: %s UTC is %s', (_, utc, offset) => {
    expect(computeTimestamp(utc).endsWith(offset)).toBe(true);
  });

  it('writes six fractional digits for CAI update times', () => {
    expect(rfc3339Micros(Date.UTC(2026, 9, 7, 18, 22, 41, 123), 'x')).toMatch(
      /^2026-10-07T18:22:41\.123\d{3}Z$/,
    );
  });
});

describe('ip', () => {
  it('intToIp reverses ipToInt', () => {
    expect(intToIp(ipToInt('203.0.113.10'))).toBe('203.0.113.10');
  });

  it('ipToInt refuses an octet above 255', () => {
    expect(() => ipToInt('10.0.0.256')).toThrow(RangeError);
  });

  it('hostAt counts hosts from the start of the range, and refuses one outside it', () => {
    expect(hostAt('10.0.4.0/22', 2)).toBe('10.0.4.2');
    expect(() => hostAt('10.0.0.0/30', 4)).toThrow(RangeError);
  });

  it.each([
    ['10.0.0.0/8', '10.240.0.0/20', true],
    ['172.16.0.0/12', '172.32.0.0/16', false],
    ['10.0.0.0/24', '10.0.0.0/16', false],
  ])(
    'cidrContains(%s, %s) is %s: true only when the second range lies inside the first',
    (outer, inner, inside) => {
      expect(cidrContains(outer, inner)).toBe(inside);
    },
  );

  it('CidrPool allocates aligned, non-overlapping ranges until it is exhausted', () => {
    const pool = new CidrPool('10.0.0.0/22', 'test');
    expect(pool.allocate(24)).toBe('10.0.0.0/24');
    expect(pool.allocate(28)).toBe('10.0.1.0/28');
    expect(pool.allocate(24)).toBe('10.0.2.0/24');
    expect(pool.address()).toBe('10.0.3.0');
    expect(() => pool.allocate(24)).toThrow(/exhausted/);
  });

  it('HostPool hands out the hosts after the reserved ones until it is exhausted', () => {
    const hosts = new HostPool('10.0.0.0/30', 2);
    expect(hosts.next()).toBe('10.0.0.2');
    expect(hosts.next()).toBe('10.0.0.3');
    expect(() => hosts.next()).toThrow(RangeError);
  });
});

describe('json', () => {
  it('setPath copies only the objects along the path', () => {
    const shared = { keep: true };
    const value: JsonObject = { a: { b: 1 }, shared };
    const next = setPath(value, ['a', 'b'], 2);
    expect(next).toEqual({ a: { b: 2 }, shared });
    expect(value).toEqual({ a: { b: 1 }, shared });
    expect(next['shared']).toBe(shared);
  });

  it('setPath creates the objects a path needs, and refuses an empty path', () => {
    expect(setPath({}, ['x', 'y'], 'z')).toEqual({ x: { y: 'z' } });
    expect(() => setPath({}, [], 1)).toThrow(RangeError);
  });

  it('getPath reads the value at a path, and nothing past a leaf', () => {
    const value: JsonObject = { a: { b: 2 } };
    expect(getPath(value, ['a', 'b'])).toBe(2);
    expect(getPath(value, ['a', 'b', 'c'])).toBeUndefined();
  });
});
