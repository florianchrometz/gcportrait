// SPDX-License-Identifier: Apache-2.0
// @ts-check
/**
 * A minimal reader for the ZIP archives Google publishes its icon sets in: the central directory, stored and
 * deflated entries, CRC-32 and size checks. No ZIP64, no encryption, no multi-disk archives; anything else is
 * refused with an error rather than half-read. Node built-ins only, so `vendor.mjs` needs no unzip binary.
 * Archives are untrusted input (`drift.mjs` reads whatever Google's page links): an entry may not declare more
 * than `MAX_ENTRY_BYTES`, and inflating never produces more than the declared size.
 */
import { Buffer } from 'node:buffer';
import { crc32, inflateRawSync } from 'node:zlib';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN_SIZE = 22;
const MAX_COMMENT = 0xffff;
const FLAG_ENCRYPTED = 0x0001;
const FLAG_UTF8 = 0x0800;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

/** The largest entry `read()` inflates; the icon files are a few kilobytes. */
export const MAX_ENTRY_BYTES = 16 * 1024 * 1024;

/**
 * @typedef {object} ZipEntry
 * @property {string} name the entry's path inside the archive, with forward slashes
 * @property {boolean} directory whether the entry is a directory
 * @property {number} size the uncompressed size in bytes
 * @property {() => Buffer} read inflates the entry and checks its size and CRC-32
 */

/**
 * @param {Buffer} archive
 * @returns {number} offset of the end-of-central-directory record
 */
function findEndOfCentralDirectory(archive) {
  const lowest = Math.max(0, archive.length - EOCD_MIN_SIZE - MAX_COMMENT);
  for (let offset = archive.length - EOCD_MIN_SIZE; offset >= lowest; offset -= 1) {
    if (archive.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error('not a ZIP archive: no end-of-central-directory record');
}

/**
 * Lists the entries of a ZIP archive held in memory, in central-directory order.
 * @param {Buffer} archive
 * @returns {ZipEntry[]}
 */
export function readZip(archive) {
  if (archive.length < EOCD_MIN_SIZE) throw new Error('not a ZIP archive: too short');
  const eocd = findEndOfCentralDirectory(archive);
  const entryCount = archive.readUInt16LE(eocd + 10);
  const directorySize = archive.readUInt32LE(eocd + 12);
  const directoryOffset = archive.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported');
  }
  if (directoryOffset + directorySize > eocd) throw new Error('corrupt ZIP archive: central directory');

  /** @type {ZipEntry[]} */
  const entries = [];
  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (archive.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) {
      throw new Error(`corrupt ZIP archive: central directory entry ${String(index)}`);
    }
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const expectedCrc = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const size = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const rawName = archive.subarray(cursor + 46, cursor + 46 + nameLength);
    // Without the UTF-8 flag the name is CP437; the icon archives use ASCII names, which both decode alike.
    const name = rawName.toString((flags & FLAG_UTF8) === 0 ? 'latin1' : 'utf8').replaceAll('\\', '/');
    cursor += 46 + nameLength + extraLength + commentLength;

    const directory = name.endsWith('/');
    entries.push({
      name,
      directory,
      size,
      read() {
        if ((flags & FLAG_ENCRYPTED) !== 0) throw new Error(`${name}: encrypted entries are not supported`);
        if (archive.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
          throw new Error(`${name}: corrupt local header`);
        }
        const localNameLength = archive.readUInt16LE(localOffset + 26);
        const localExtraLength = archive.readUInt16LE(localOffset + 28);
        const start = localOffset + 30 + localNameLength + localExtraLength;
        const compressed = archive.subarray(start, start + compressedSize);
        /** @type {Buffer} */
        let data;
        if (size > MAX_ENTRY_BYTES)
          throw new Error(
            `${name}: ${String(size)} bytes, above the ${String(MAX_ENTRY_BYTES)}-byte entry cap`,
          );
        if (method === METHOD_STORED) data = Buffer.from(compressed);
        else if (method === METHOD_DEFLATED) {
          try {
            data = inflateRawSync(compressed, { maxOutputLength: Math.max(1, size) });
          } catch (error) {
            throw new Error(
              `${name}: does not inflate to its declared ${String(size)} bytes (${error instanceof Error ? error.message : String(error)})`,
              { cause: error },
            );
          }
        } else throw new Error(`${name}: compression method ${String(method)} is not supported`);
        if (data.length !== size)
          throw new Error(`${name}: size ${String(data.length)}, expected ${String(size)}`);
        if (crc32(data) !== expectedCrc) throw new Error(`${name}: CRC-32 mismatch`);
        return data;
      },
    });
  }
  return entries;
}

/**
 * Whether an entry name is safe to write below a directory: relative, no `..` segment, no drive letter.
 * @param {string} name
 * @returns {boolean}
 */
export function isSafeEntryName(name) {
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every((segment) => segment !== '..');
}
