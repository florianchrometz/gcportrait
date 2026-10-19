// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { exportFileName, fileNamePart, readTimePart } from './fileName';

describe('exportFileName', () => {
  it('is gcportrait_<scope>_<lens>_<readTime>.<ext> (skill gcp-diagram-style §8)', () => {
    const parts = { scope: 'example.com', lens: 'overview', readTime: '2026-10-08T00:00:00Z' };
    expect(exportFileName(parts, 'svg')).toBe('gcportrait_example.com_overview_20261008T000000Z.svg');
    expect(exportFileName({ ...parts, lens: 'load-balancing' }, 'png')).toBe(
      'gcportrait_example.com_load-balancing_20261008T000000Z.png',
    );
  });

  it('writes the read time at UTC in ISO-8601 basic format, whatever offset or fraction it came with', () => {
    expect(readTimePart('2026-10-08T02:00:00+02:00')).toBe('20261008T000000Z');
    expect(readTimePart('2026-10-08T00:00:00.123456Z')).toBe('20261008T000000Z');
    expect(readTimePart('not a time')).toBe('not-a-time');
    expect(readTimePart('')).toBe('undated');
  });

  it('keeps only characters every desktop file system accepts', () => {
    expect(fileNamePart('Retail web (prod)', 'scope')).toBe('Retail-web-prod');
    expect(fileNamePart('folders/20000000001', 'scope')).toBe('folders-20000000001');
    expect(fileNamePart('Ünïcödé Präsentation', 'scope')).toBe('Unicode-Prasentation');
    expect(fileNamePart(' ..hidden.. ', 'scope')).toBe('hidden');
    expect(fileNamePart('a: b * c? "d" <e> |f|', 'scope')).toBe('a-b-c-d-e-f');
    expect(fileNamePart('???', 'scope')).toBe('scope');
    const name = exportFileName(
      { scope: 'x'.repeat(300), lens: 'overview', readTime: '2026-10-08T00:00:00Z' },
      'svg',
    );
    expect(name).toBe(`gcportrait_${'x'.repeat(64)}_overview_20261008T000000Z.svg`);
    expect(name).toMatch(/^[A-Za-z0-9._-]+$/);
  });
});
