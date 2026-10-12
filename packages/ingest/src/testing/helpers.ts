// SPDX-License-Identifier: MIT
/**
 * Test helpers, not part of the public API. Synthetic values only: organisation 30000000001, folders
 * 2000000000x, project numbers 1000000000x, `example.com` addresses, private IP ranges.
 */
import { IngestError } from '../errors.js';
import type { ByteStream, ByteStreamReadResult } from '../platform.js';
import type { IngestOptions } from '../session.js';

interface Utf8Encoder {
  encode(text: string): Uint8Array;
}

const Encoder = (globalThis as unknown as { TextEncoder: new () => Utf8Encoder }).TextEncoder;
const encoder = new Encoder();

/** A structured clone, as postMessage makes it (the runtime provides structuredClone). */
export function clone<T>(value: T): T {
  return (globalThis as unknown as { structuredClone: <U>(input: U) => U }).structuredClone(value);
}

/** UTF-8 bytes of a string (TextEncoder, which the test runtime provides). */
export function utf8(text: string): Uint8Array {
  return encoder.encode(text);
}

/** Concatenates byte arrays. */
export function joinBytes(parts: readonly Uint8Array[]): Uint8Array {
  const joined = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

/** Splits bytes at the given offsets (sorted, deduplicated, clamped). */
export function splitAt(bytes: Uint8Array, offsets: readonly number[]): Uint8Array[] {
  const cuts = [...new Set(offsets.map((offset) => Math.max(0, Math.min(bytes.length, offset))))].sort(
    (left, right) => left - right,
  );
  const pieces: Uint8Array[] = [];
  let start = 0;
  for (const cut of [...cuts, bytes.length]) {
    pieces.push(bytes.slice(start, cut));
    start = cut;
  }
  return pieces;
}

/** Splits bytes into chunks of a fixed size. */
export function chunked(bytes: Uint8Array, size: number): Uint8Array[] {
  const pieces: Uint8Array[] = [];
  for (let start = 0; start < bytes.length; start += size) pieces.push(bytes.slice(start, start + size));
  return pieces;
}

/** An async iterable over the given chunks. */
export async function* iterate<T>(chunks: readonly T[]): AsyncGenerator<T> {
  for (const chunk of chunks) {
    await Promise.resolve();
    yield chunk;
  }
}

/** Splits text into pieces of a fixed number of UTF-16 code units. */
export function chunkText(text: string, size: number): string[] {
  const pieces: string[] = [];
  for (let start = 0; start < text.length; start += size) pieces.push(text.slice(start, start + size));
  return pieces;
}

/** A WHATWG-like byte stream over fixed chunks that records whether it was cancelled and released. */
export function byteStream(
  chunks: readonly unknown[],
): ByteStream & { cancelled: boolean; released: boolean } {
  const queue = [...chunks];
  const stream = {
    cancelled: false,
    released: false,
    getReader() {
      return {
        read: (): Promise<ByteStreamReadResult> =>
          Promise.resolve(
            queue.length === 0 ? { done: true } : { done: false, value: queue.shift() as Uint8Array },
          ),
        cancel: (): Promise<void> => {
          stream.cancelled = true;
          return Promise.resolve();
        },
        releaseLock: () => {
          stream.released = true;
        },
      };
    },
  };
  return stream;
}

/** The IngestError that `body` throws; fails the test when it throws nothing or something else. */
export function caught(body: () => unknown): IngestError {
  try {
    body();
  } catch (error) {
    if (error instanceof IngestError) return error;
    throw error;
  }
  throw new Error('expected an IngestError');
}

/** 2026-10-08T12:00:00.000Z, a fixed clock reading. */
export const FIXED_TIME = Date.UTC(2026, 9, 8, 12, 0, 0);

/** A deterministic entropy source (a 32-bit xorshift generator), for repeatable snapshot ids. */
export function seededEntropy(seed = 0x9e3779b9): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 2 ** 32;
  };
}

/** Options for an organisation-scope export with a fixed clock and entropy. */
export function testOptions(overrides: Partial<IngestOptions> = {}): IngestOptions {
  return {
    scope: { kind: 'organization', id: '30000000001', displayName: 'example.com' },
    source: { kind: 'export', detail: 'test.ndjson' },
    clock: () => FIXED_TIME,
    entropy: seededEntropy(),
    ...overrides,
  };
}

export const ORG = 'organizations/30000000001';
export const FOLDER = 'folders/20000000001';
export const PROJECT_NUMBER = '10000000001';
export const PROJECT_ID = 'demo-net-1';

/** A raw CAI asset (RESOURCE content type) in the assets.list shape; fields can be overridden. */
export function rawAsset(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: `//compute.googleapis.com/projects/${PROJECT_ID}/global/networks/core`,
    assetType: 'compute.googleapis.com/Network',
    resource: {
      version: 'v1',
      discoveryDocumentUri: 'https://www.googleapis.com/discovery/v1/apis/compute/v1/rest',
      discoveryName: 'Network',
      parent: `//cloudresourcemanager.googleapis.com/projects/${PROJECT_NUMBER}`,
      data: {
        name: 'core',
        autoCreateSubnetworks: false,
        selfLink: `https://www.googleapis.com/compute/v1/projects/${PROJECT_ID}/global/networks/core`,
      },
      location: 'global',
    },
    ancestors: [`projects/${PROJECT_NUMBER}`, FOLDER, ORG],
    updateTime: '2026-10-07T18:22:41.123456Z',
    ...overrides,
  };
}

/** Envelope keys that the files `exportAssets` writes spell in snake_case (`data` keeps the API's keys). */
const EXPORT_KEYS: Readonly<Record<string, string>> = {
  assetType: 'asset_type',
  updateTime: 'update_time',
  discoveryDocumentUri: 'discovery_document_uri',
  discoveryName: 'discovery_name',
};

function snakeKeys(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [EXPORT_KEYS[key] ?? key, value]));
}

/**
 * The same asset as an `exportAssets` file line: snake_case envelope keys (`asset_type`, `update_time`,
 * `resource.discovery_document_uri`, `resource.discovery_name`), everything else unchanged and in order.
 */
export function exportShape(asset: Record<string, unknown>): Record<string, unknown> {
  const resource = asset['resource'];
  const shaped = snakeKeys(asset);
  if (typeof resource === 'object' && resource !== null && !Array.isArray(resource)) {
    shaped['resource'] = snakeKeys(resource as Record<string, unknown>);
  }
  return shaped;
}

/** A raw Compute asset `n` with a distinct name. */
export function numberedAsset(n: number, updateTime = '2026-10-07T18:22:41Z'): Record<string, unknown> {
  return rawAsset({
    name: `//compute.googleapis.com/projects/${PROJECT_ID}/global/networks/net-${String(n)}`,
    updateTime,
  });
}

/** One NDJSON line (with its LF) per value. */
export function ndjson(values: readonly unknown[]): string {
  return values.map((value) => `${JSON.stringify(value)}\n`).join('');
}
