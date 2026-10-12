// SPDX-License-Identifier: MIT
/**
 * WOFF 1.0 → TrueType (sfnt) for the debug renderer: the rasteriser loads TrueType files, the fontsource
 * packages ship WOFF. A WOFF file is the sfnt's tables, each zlib-compressed when that saves space, behind a
 * table directory (W3C WOFF 1.0, sections 3–5); unwrapping it is lossless.
 */
import { inflateSync } from 'node:zlib';

const WOFF_SIGNATURE = 0x774f4646; // 'wOFF'
const WOFF_HEADER_SIZE = 44;
const WOFF_ENTRY_SIZE = 20;
const SFNT_HEADER_SIZE = 12;
const SFNT_ENTRY_SIZE = 16;

interface TableEntry {
  readonly tag: number;
  readonly checksum: number;
  readonly data: Buffer;
}

export function woffToSfnt(woff: Buffer): Buffer {
  if (woff.length < WOFF_HEADER_SIZE || woff.readUInt32BE(0) !== WOFF_SIGNATURE) {
    throw new Error('not a WOFF 1.0 file');
  }
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);
  const tables: TableEntry[] = [];
  for (let i = 0; i < numTables; i += 1) {
    const at = WOFF_HEADER_SIZE + i * WOFF_ENTRY_SIZE;
    const tag = woff.readUInt32BE(at);
    const offset = woff.readUInt32BE(at + 4);
    const compLength = woff.readUInt32BE(at + 8);
    const origLength = woff.readUInt32BE(at + 12);
    const checksum = woff.readUInt32BE(at + 16);
    const stored = woff.subarray(offset, offset + compLength);
    const data = compLength < origLength ? inflateSync(stored) : Buffer.from(stored);
    if (data.length !== origLength) throw new Error(`WOFF table ${tag.toString(16)} has the wrong length`);
    tables.push({ tag, checksum, data });
  }
  let power = 1;
  let selector = 0;
  while (power * 2 <= numTables) {
    power *= 2;
    selector += 1;
  }
  const directorySize = SFNT_HEADER_SIZE + numTables * SFNT_ENTRY_SIZE;
  const padded = (length: number): number => (length + 3) & ~3;
  const total = tables.reduce((sum, table) => sum + padded(table.data.length), directorySize);
  const sfnt = Buffer.alloc(total);
  sfnt.writeUInt32BE(flavor, 0);
  sfnt.writeUInt16BE(numTables, 4);
  sfnt.writeUInt16BE(power * 16, 6);
  sfnt.writeUInt16BE(selector, 8);
  sfnt.writeUInt16BE(numTables * 16 - power * 16, 10);
  let offset = directorySize;
  tables.forEach((table, index) => {
    const at = SFNT_HEADER_SIZE + index * SFNT_ENTRY_SIZE;
    sfnt.writeUInt32BE(table.tag, at);
    sfnt.writeUInt32BE(table.checksum, at + 4);
    sfnt.writeUInt32BE(offset, at + 8);
    sfnt.writeUInt32BE(table.data.length, at + 12);
    table.data.copy(sfnt, offset);
    offset += padded(table.data.length);
  });
  return sfnt;
}
