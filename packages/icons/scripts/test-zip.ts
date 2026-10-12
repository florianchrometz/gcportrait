// SPDX-License-Identifier: MIT
/**
 * Test helpers: a minimal ZIP writer (local headers, data, central directory, end record) for synthetic icon
 * archives, so that the zip reader and the drift check are tested without the network.
 */
import { Buffer } from 'node:buffer';
import { crc32, deflateRawSync } from 'node:zlib';

export interface ZipEntrySpec {
  readonly name: string;
  readonly data: Buffer;
  readonly method: 0 | 8;
  readonly crc?: number;
  /** The uncompressed size the headers declare (default: the data's length). */
  readonly size?: number;
}

/** A minimal ZIP writer for the tests: local headers, data, central directory, end record. */
export function zip(entries: readonly ZipEntrySpec[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const body = entry.method === 8 ? deflateRawSync(entry.data) : entry.data;
    const crc = entry.crc ?? crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.size ?? entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(entry.size ?? entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

/** A ZIP archive of SVG files, deflated, from entry name → file text. */
export function svgZip(files: Readonly<Record<string, string>>): Buffer {
  return zip(
    Object.entries(files).map(([name, text]) => ({
      name,
      data: Buffer.from(text, 'utf8'),
      method: 8 as const,
    })),
  );
}
