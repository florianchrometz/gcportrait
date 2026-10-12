// SPDX-License-Identifier: MIT
/**
 * How a stored snapshot's documents sit in IndexedDB (storage/db.ts, `StoredSnapshot.blob` and `.history`): JSON
 * text in a Blob, gzip-compressed with the platform's `CompressionStream` where there is one (every browser the
 * app supports; JSON shrinks about twelvefold, so demo XL with its history takes 13.9 MB instead of 172 MB),
 * plain otherwise. The Blob's type says which (`GZIP_TYPE` or `JSON_TYPE`), so a reader never guesses. Runs in
 * workers and on the page alike; nothing here parses more than it is asked to.
 */

export const JSON_TYPE = 'application/json';
export const GZIP_TYPE = 'application/gzip';

/** A Blob of `text`, compressed when the platform can. */
export async function encodeText(text: string): Promise<Blob> {
  const plain = new Blob([text], { type: JSON_TYPE });
  if (typeof CompressionStream !== 'function') return plain;
  const stream = plain.stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream, { headers: { 'Content-Type': GZIP_TYPE } }).blob();
}

/** `value` as JSON in a Blob (compressed when the platform can). */
export function encodeJson(value: unknown): Promise<Blob> {
  return encodeText(JSON.stringify(value));
}

/** The plain JSON of a blob `encodeText` wrote, as a Blob, without reading it into a string. */
export async function plainBlob(blob: Blob): Promise<Blob> {
  if (blob.type !== GZIP_TYPE) return blob;
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream, { headers: { 'Content-Type': JSON_TYPE } }).blob();
}

/** The JSON text of a blob `encodeText` wrote. */
export async function decodeText(blob: Blob): Promise<string> {
  return (await plainBlob(blob)).text();
}

/** The value of a blob `encodeJson` wrote (unvalidated: the caller checks its shape). */
export async function decodeJson(blob: Blob): Promise<unknown> {
  return JSON.parse(await decodeText(blob)) as unknown;
}
