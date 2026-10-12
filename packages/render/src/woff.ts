// SPDX-License-Identifier: MIT
/**
 * WOFF 1.0 → OpenType (sfnt). The rasteriser loads OpenType files from disk; the `@fontsource` packages ship
 * the faces as WOFF, which is the same sfnt tables, each zlib-compressed when that is smaller, behind a WOFF
 * header and table directory (W3C WOFF File Format 1.0, §3–§5). Unwrapping restores the tables byte for byte;
 * nothing in the font is changed.
 */
import { inflateSync } from 'node:zlib';

/** 'wOFF' */
const WOFF_SIGNATURE = 0x77_4f_46_46;
const WOFF_HEADER_BYTES = 44;
const WOFF_DIRECTORY_ENTRY_BYTES = 20;
const SFNT_HEADER_BYTES = 12;
const SFNT_RECORD_BYTES = 16;

export class WoffError extends Error {
  constructor(message: string) {
    super(`WOFF: ${message}`);
    this.name = 'WoffError';
  }
}

interface WoffTable {
  readonly tag: number;
  readonly checksum: number;
  readonly bytes: Uint8Array;
}

function tagText(tag: number): string {
  return String.fromCharCode((tag >>> 24) & 0xff, (tag >>> 16) & 0xff, (tag >>> 8) & 0xff, tag & 0xff);
}

const alignTo4 = (length: number): number => Math.ceil(length / 4) * 4;

/** The sfnt (TrueType or CFF-flavoured OpenType) inside a WOFF 1.0 file. */
export function woffToSfnt(woff: Uint8Array): Uint8Array {
  const view = new DataView(woff.buffer, woff.byteOffset, woff.byteLength);
  if (woff.byteLength < WOFF_HEADER_BYTES || view.getUint32(0) !== WOFF_SIGNATURE) {
    throw new WoffError('not a WOFF 1.0 file');
  }
  const flavor = view.getUint32(4);
  const declaredLength = view.getUint32(8);
  const tableCount = view.getUint16(12);
  if (declaredLength !== woff.byteLength) {
    throw new WoffError(`header says ${String(declaredLength)} bytes, file has ${String(woff.byteLength)}`);
  }
  if (tableCount === 0) throw new WoffError('no tables');
  const directoryEnd = WOFF_HEADER_BYTES + tableCount * WOFF_DIRECTORY_ENTRY_BYTES;
  if (directoryEnd > woff.byteLength) throw new WoffError('table directory runs past the end of the file');

  const tables: WoffTable[] = [];
  for (let index = 0; index < tableCount; index += 1) {
    const entry = WOFF_HEADER_BYTES + index * WOFF_DIRECTORY_ENTRY_BYTES;
    const tag = view.getUint32(entry);
    const offset = view.getUint32(entry + 4);
    const storedLength = view.getUint32(entry + 8);
    const length = view.getUint32(entry + 12);
    const checksum = view.getUint32(entry + 16);
    if (offset + storedLength > woff.byteLength || storedLength > length) {
      throw new WoffError(`table ${tagText(tag)} has an invalid offset or length`);
    }
    const stored = woff.subarray(offset, offset + storedLength);
    // A table is stored compressed exactly when that made it smaller (§5).
    const bytes = storedLength < length ? new Uint8Array(inflateSync(stored)) : stored;
    if (bytes.byteLength !== length) {
      throw new WoffError(
        `table ${tagText(tag)} inflates to ${String(bytes.byteLength)} bytes, not ${String(length)}`,
      );
    }
    tables.push({ tag, checksum, bytes });
  }

  // The offset table's binary-search fields (OpenType spec, "Organization of an OpenType font").
  const entrySelector = Math.floor(Math.log2(tableCount));
  const searchRange = 2 ** entrySelector * SFNT_RECORD_BYTES;
  const rangeShift = tableCount * SFNT_RECORD_BYTES - searchRange;

  let size = SFNT_HEADER_BYTES + tableCount * SFNT_RECORD_BYTES;
  const offsets = tables.map((table) => {
    const at = size;
    size += alignTo4(table.bytes.byteLength);
    return at;
  });
  const sfnt = new Uint8Array(size);
  const out = new DataView(sfnt.buffer);
  out.setUint32(0, flavor);
  out.setUint16(4, tableCount);
  out.setUint16(6, searchRange);
  out.setUint16(8, entrySelector);
  out.setUint16(10, rangeShift);
  tables.forEach((table, index) => {
    const record = SFNT_HEADER_BYTES + index * SFNT_RECORD_BYTES;
    const offset = offsets[index] ?? 0;
    out.setUint32(record, table.tag);
    out.setUint32(record + 4, table.checksum);
    out.setUint32(record + 8, offset);
    out.setUint32(record + 12, table.bytes.byteLength);
    sfnt.set(table.bytes, offset);
  });
  return sfnt;
}
