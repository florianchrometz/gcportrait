// SPDX-License-Identifier: MIT
import { measureText } from '@gcportrait/layout';
import { describe, expect, it, vi } from 'vitest';

import { TAGLINE } from '../branding';
import { formatReadTime, titleBlock, viewerOffsetMinutes } from './titleBlock';

describe('formatReadTime', () => {
  it.each([
    ['2026-10-08T00:00:00Z', 0, '2026-10-08T00:00:00+00:00'],
    ['2026-10-08T00:00:00Z', 120, '2026-10-08T02:00:00+02:00'],
    ['2026-10-08T00:00:00Z', -300, '2026-10-07T19:00:00-05:00'],
    ['2026-10-08T00:00:00Z', 330, '2026-10-08T05:30:00+05:30'],
    ['2026-10-08T10:15:30.250+02:00', 0, '2026-10-08T08:15:30+00:00'],
    ['2026-12-31T23:30:00Z', 60, '2027-01-01T00:30:00+01:00'],
  ])('%s at %s minutes is %s', (readTime, offset, expected) => {
    expect(formatReadTime(readTime, offset)).toBe(expected);
  });

  it('returns a value that is not a timestamp unchanged', () => {
    expect(formatReadTime('yesterday', 60)).toBe('yesterday');
  });

  // Like ticks.test.ts, this changes the process's time zone, which only this file's process sees (vitest's default
  // `forks` pool runs each test file in a process of its own).
  it("reads the viewer's offset from the platform at the read time, east positive, never -0", () => {
    try {
      vi.stubEnv('TZ', 'America/Los_Angeles');
      expect(viewerOffsetMinutes('2026-10-08T00:00:00Z')).toBe(-420);
      // Daylight saving time ended on 1 November 2026: the offset is the one at the read time.
      expect(viewerOffsetMinutes('2026-12-08T00:00:00Z')).toBe(-480);
      vi.stubEnv('TZ', 'UTC');
      expect(Object.is(viewerOffsetMinutes('2026-10-08T00:00:00Z'), 0)).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('titleBlock (style skill §7)', () => {
  it('names the scope, the lens and the read time, and ends with the tagline, on the canvas and in exports', () => {
    const block = titleBlock('example.com', 'Networking', '2026-10-08T00:00:00Z', 120);
    expect(block.scope).toMatchObject({ text: 'example.com', size: 15, weight: 500, tone: 'ink' });
    expect(block.meta.text).toBe('Networking lens · read 2026-10-08T02:00:00+02:00');
    expect(block.meta.tone).toBe('muted');
    expect(block.tagline).toMatchObject({
      text: TAGLINE,
      size: 10.5,
      weight: 400,
      tone: 'muted',
      baseline: 50,
    });
    // Three lines and no more: the non-affiliation statement is in the app footer, never in a drawing.
    expect(Object.keys(block).sort()).toEqual(['height', 'meta', 'scope', 'tagline', 'width']);
    expect([block.scope, block.meta, block.tagline].map((line) => line.text).join('\n')).not.toMatch(
      /affiliated/i,
    );
    expect(block.height).toBe(54);
    for (const line of [block.scope, block.meta, block.tagline]) {
      expect(line.size).toBeGreaterThanOrEqual(10.5);
      expect(block.width).toBeGreaterThanOrEqual(Math.floor(measureText(line.text, line.weight, line.size)));
    }
  });
});
