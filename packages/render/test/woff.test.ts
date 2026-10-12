// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

import { faceFiles, FONT_FACES, WoffError, woffToSfnt } from '../src/index.js';

/** The OpenType table checksum: the sum of the table's big-endian uint32 words, zero-padded. */
function tableChecksum(bytes: Uint8Array): number {
  const padded = new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4);
  padded.set(bytes);
  const view = new DataView(padded.buffer);
  let sum = 0;
  for (let at = 0; at < padded.byteLength; at += 4) sum = (sum + view.getUint32(at)) >>> 0;
  return sum;
}

function tagOf(view: DataView, at: number): string {
  return String.fromCharCode(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3),
  );
}

/** A WOFF file around the given tables (the inverse of the unwrapper, for the tests). */
function makeWoff(tables: ReadonlyArray<{ tag: string; data: Uint8Array; compress: boolean }>): Uint8Array {
  const entries = tables.map((table) => {
    const stored = table.compress ? new Uint8Array(deflateSync(table.data)) : table.data;
    return { ...table, stored };
  });
  let offset = 44 + 20 * entries.length;
  const offsets = entries.map((entry) => {
    const at = offset;
    offset += Math.ceil(entry.stored.byteLength / 4) * 4;
    return at;
  });
  const woff = new Uint8Array(offset);
  const view = new DataView(woff.buffer);
  view.setUint32(0, 0x774f4646);
  view.setUint32(4, 0x00010000);
  view.setUint32(8, woff.byteLength);
  view.setUint16(12, entries.length);
  entries.forEach((entry, index) => {
    const at = 44 + 20 * index;
    for (let i = 0; i < 4; i += 1) view.setUint8(at + i, entry.tag.charCodeAt(i));
    view.setUint32(at + 4, offsets[index] ?? 0);
    view.setUint32(at + 8, entry.stored.byteLength);
    view.setUint32(at + 12, entry.data.byteLength);
    view.setUint32(at + 16, tableChecksum(entry.data));
    woff.set(entry.stored, offsets[index] ?? 0);
  });
  return woff;
}

describe('woffToSfnt', () => {
  it('restores every table of the self-hosted Roboto faces with its recorded checksum', () => {
    for (const face of FONT_FACES) {
      const [latin] = faceFiles(face);
      expect(latin).toMatch(/-latin-\d{3}-normal\.woff$/);
      const sfnt = woffToSfnt(readFileSync(latin ?? ''));
      const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
      expect(view.getUint32(0)).toBe(0x00010000);
      const count = view.getUint16(4);
      expect(count).toBeGreaterThan(8);
      expect(view.getUint16(6)).toBe(2 ** Math.floor(Math.log2(count)) * 16);
      const tags: string[] = [];
      for (let index = 0; index < count; index += 1) {
        const record = 12 + 16 * index;
        const tag = tagOf(view, record);
        tags.push(tag);
        const offset = view.getUint32(record + 8);
        const length = view.getUint32(record + 12);
        expect(offset % 4).toBe(0);
        // `head` holds checkSumAdjustment, which its recorded checksum counts as zero.
        if (tag !== 'head')
          expect(tableChecksum(sfnt.subarray(offset, offset + length))).toBe(view.getUint32(record + 4));
      }
      expect(tags).toEqual([...tags].sort());
      expect(tags).toEqual(
        expect.arrayContaining(['cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name']),
      );
    }
  });

  it('inflates compressed tables and copies stored ones', () => {
    const text = new TextEncoder().encode('gcportrait '.repeat(40));
    const odd = new Uint8Array([1, 2, 3, 4, 5]);
    const sfnt = woffToSfnt(
      makeWoff([
        { tag: 'aaaa', data: text, compress: true },
        { tag: 'bbbb', data: odd, compress: false },
        { tag: 'cccc', data: odd, compress: false },
      ]),
    );
    const view = new DataView(sfnt.buffer);
    expect(view.getUint16(4)).toBe(3);
    expect([view.getUint16(6), view.getUint16(8), view.getUint16(10)]).toEqual([32, 1, 16]);
    const table = (index: number): Uint8Array => {
      const record = 12 + 16 * index;
      const offset = view.getUint32(record + 8);
      return sfnt.subarray(offset, offset + view.getUint32(record + 12));
    };
    expect(table(0)).toEqual(text);
    expect(table(1)).toEqual(odd);
    expect(table(2)).toEqual(odd);
    expect(sfnt.byteLength % 4).toBe(0);
  });

  it('refuses what is not a sound WOFF 1.0 file', () => {
    expect(() => woffToSfnt(new Uint8Array(10))).toThrow(WoffError);
    const good = makeWoff([{ tag: 'aaaa', data: new Uint8Array(8), compress: false }]);
    expect(() => woffToSfnt(good.subarray(0, good.byteLength - 4))).toThrow(/header says/);
    const wrongLength = good.slice();
    new DataView(wrongLength.buffer).setUint32(44 + 12, 4);
    expect(() => woffToSfnt(wrongLength)).toThrow(/invalid offset or length/);
    const noTables = good.slice(0, 44);
    new DataView(noTables.buffer).setUint32(8, 44);
    new DataView(noTables.buffer).setUint16(12, 0);
    expect(() => woffToSfnt(noTables)).toThrow(/no tables/);
    const shortDirectory = good.slice(0, 50);
    new DataView(shortDirectory.buffer).setUint32(8, 50);
    expect(() => woffToSfnt(shortDirectory)).toThrow(/runs past the end/);
    const badInflate = makeWoff([{ tag: 'aaaa', data: new Uint8Array(64), compress: true }]);
    new DataView(badInflate.buffer).setUint32(44 + 12, 65);
    expect(() => woffToSfnt(badInflate)).toThrow(/inflates to 64 bytes, not 65/);
  });
});
