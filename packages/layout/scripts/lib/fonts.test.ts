// SPDX-License-Identifier: Apache-2.0
/**
 * The metrics generator's font helpers: unicode-range parsing (scripts/lib/fonts.ts) and WOFF unwrapping for the
 * debug renderer (scripts/lib/woff.ts). Whether the committed table is current is test/metrics.test.ts.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { faceFiles, parseUnicodeRange } from './fonts.js';
import { woffToSfnt } from './woff.js';

type OpenType = typeof import('opentype.js');
const opentype = createRequire(import.meta.url)('opentype.js') as OpenType;

describe('parseUnicodeRange', () => {
  it('reads single code points, ranges and wildcards', () => {
    expect(parseUnicodeRange('U+0000-00FF, U+0131,U+4??')).toEqual([
      [0, 0xff],
      [0x131, 0x131],
      [0x400, 0x4ff],
    ]);
  });

  it('refuses anything else', () => {
    expect(() => parseUnicodeRange('0041')).toThrow(/cannot read/);
  });
});

describe('woffToSfnt', () => {
  it('unwraps a WOFF file into the same font', () => {
    const [file] = faceFiles('sans-700').filter((candidate) => candidate.includes('-latin-700'));
    if (file === undefined) throw new Error('no latin 700 subset');
    const woff = readFileSync(file);
    const sfnt = woffToSfnt(woff);
    expect(sfnt.readUInt32BE(0)).toBe(0x00010000); // TrueType
    const toArrayBuffer = (bytes: Buffer): ArrayBuffer =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const fromWoff = opentype.parse(toArrayBuffer(woff));
    const fromSfnt = opentype.parse(toArrayBuffer(sfnt));
    expect(fromSfnt.numGlyphs).toBe(fromWoff.numGlyphs);
    expect(fromSfnt.glyphs.get(fromSfnt.charToGlyphIndex('W')).advanceWidth).toBe(
      fromWoff.glyphs.get(fromWoff.charToGlyphIndex('W')).advanceWidth,
    );
  });

  it('refuses a file that is not WOFF 1.0', () => {
    expect(() => woffToSfnt(Buffer.from('not a font at all, certainly not one with a header'))).toThrow(
      /WOFF/,
    );
  });

  it('refuses a WOFF file whose table directory runs past EOF', () => {
    const header = Buffer.alloc(44);
    header.writeUInt32BE(0x774f4646, 0); // 'wOFF'
    header.writeUInt16BE(10, 12); // numTables = 10, requires 44 + 200 = 244 bytes
    expect(() => woffToSfnt(header)).toThrow(/table directory runs past the end of the file/);
  });

  it('refuses a WOFF file whose table offset or length is invalid', () => {
    const buf = Buffer.alloc(64);
    buf.writeUInt32BE(0x774f4646, 0); // 'wOFF'
    buf.writeUInt16BE(1, 12); // numTables = 1
    // Table entry at offset 44: tag, offset, compLength, origLength, checksum
    buf.writeUInt32BE(0x68656164, 44); // 'head'
    buf.writeUInt32BE(100, 48); // offset = 100 > buf.length (64)
    buf.writeUInt32BE(10, 52); // compLength = 10
    buf.writeUInt32BE(10, 56); // origLength = 10
    expect(() => woffToSfnt(buf)).toThrow(/invalid offset or length/);
  });

  it('refuses a WOFF file where compressed length exceeds original length', () => {
    const buf = Buffer.alloc(64);
    buf.writeUInt32BE(0x774f4646, 0); // 'wOFF'
    buf.writeUInt16BE(1, 12); // numTables = 1
    buf.writeUInt32BE(0x68656164, 44); // 'head'
    buf.writeUInt32BE(60, 48); // offset = 60
    buf.writeUInt32BE(4, 52); // compLength = 4
    buf.writeUInt32BE(2, 56); // origLength = 2 (< compLength)
    expect(() => woffToSfnt(buf)).toThrow(/invalid offset or length/);
  });
});
