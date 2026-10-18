// SPDX-License-Identifier: Apache-2.0
import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';

import { MAX_ENTRY_BYTES, isSafeEntryName, readZip } from './lib/zip.mjs';
import { zip } from './test-zip.js';

describe('readZip', () => {
  it('lists stored and deflated entries and reads them back', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"/>'.repeat(20));
    const entries = readZip(
      zip([
        { name: 'Icons/', data: Buffer.alloc(0), method: 0 },
        { name: 'Icons/a.svg', data: svg, method: 8 },
        { name: 'Icons/b.txt', data: Buffer.from('plain'), method: 0 },
      ]),
    );
    expect(entries.map((entry) => [entry.name, entry.directory, entry.size])).toEqual([
      ['Icons/', true, 0],
      ['Icons/a.svg', false, svg.length],
      ['Icons/b.txt', false, 5],
    ]);
    expect(entries[1]?.read().equals(svg)).toBe(true);
    expect(entries[2]?.read().toString()).toBe('plain');
  });

  it('refuses an entry whose CRC-32 does not match', () => {
    const [entry] = readZip(zip([{ name: 'a.svg', data: Buffer.from('abc'), method: 8, crc: 1 }]));
    expect(() => entry?.read()).toThrow(/CRC-32 mismatch/);
  });

  it('refuses an entry that declares more than the entry cap, or inflates beyond its declared size', () => {
    const data = Buffer.from('<svg/>'.repeat(100));
    const [huge] = readZip(zip([{ name: 'a.svg', data, method: 8, size: MAX_ENTRY_BYTES + 1 }]));
    expect(() => huge?.read()).toThrow(/entry cap/);
    const [bomb] = readZip(zip([{ name: 'b.svg', data, method: 8, size: 10 }]));
    expect(() => bomb?.read()).toThrow(/does not inflate to its declared 10 bytes/);
  });

  it('refuses data that is not a ZIP archive', () => {
    expect(() => readZip(Buffer.from('not a zip'))).toThrow(/too short/);
    expect(() => readZip(Buffer.alloc(64))).toThrow(/no end-of-central-directory/);
  });
});

describe('isSafeEntryName', () => {
  it.each([
    ['Category Icons/Networking/SVG/Networking-512-color-rgb.svg', true],
    ['cloud_run/cloud_run.svg', true],
    ['../escape.svg', false],
    ['a/../../escape.svg', false],
    ['/etc/passwd', false],
    ['C:/x.svg', false],
  ])('%s → %s', (name, safe) => {
    expect(isSafeEntryName(name)).toBe(safe);
  });
});
