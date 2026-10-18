// SPDX-License-Identifier: Apache-2.0
/**
 * The few host APIs this package touches, typed structurally. The package compiles without the DOM and Node
 * type libraries (a pure core may not reach for either), so the WHATWG stream, Blob and TextDecoder shapes it
 * accepts are declared here. Browser, worker and Node objects all satisfy them.
 */
import { IngestError } from './errors.js';

/** The result of one `read()` on a stream reader. */
export interface ByteStreamReadResult {
  readonly done: boolean;
  readonly value?: Uint8Array | undefined;
}

/** The default reader of a byte stream (`ReadableStreamDefaultReader<Uint8Array>`). */
export interface ByteStreamReader {
  read(): Promise<ByteStreamReadResult>;
  cancel(reason?: unknown): Promise<void>;
  releaseLock(): void;
}

/** A WHATWG `ReadableStream<Uint8Array>`, such as a `fetch` Response body or `Blob.stream()`. */
export interface ByteStream {
  getReader(): ByteStreamReader;
}

/** A `Blob` or `File` (browser) or a Node `Blob`: anything with a byte `stream()`. */
export interface BlobLike {
  readonly size: number;
  stream(): ByteStream;
}

/** The part of `TextDecoder` this package uses. */
export interface Utf8Decoder {
  decode(input: Uint8Array): string;
}

interface Utf8DecoderConstructor {
  new (label: 'utf-8', options: { fatal: boolean; ignoreBOM: boolean }): Utf8Decoder;
}

/**
 * A strict UTF-8 decoder: invalid byte sequences throw instead of becoming U+FFFD, and a byte-order mark is
 * kept (the line reader strips it itself).
 */
export function createUtf8Decoder(): Utf8Decoder {
  const Decoder = (globalThis as unknown as { TextDecoder?: Utf8DecoderConstructor }).TextDecoder;
  if (typeof Decoder !== 'function') {
    throw new IngestError('unsupported-platform', 'TextDecoder is not available in this environment.');
  }
  return new Decoder('utf-8', { fatal: true, ignoreBOM: true });
}

/** Whether a value has a `getReader()` method, i.e. is a WHATWG readable stream. */
export function isByteStream(value: unknown): value is ByteStream {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { getReader?: unknown }).getReader === 'function'
  );
}

/** Whether a value has a `stream()` method, i.e. is a Blob or File. */
export function isBlobLike(value: unknown): value is BlobLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { stream?: unknown }).stream === 'function'
  );
}

/** Whether a value can be iterated with `for await`. */
export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  );
}

/** Whether a value can be iterated with `for … of`. */
export function isIterable(value: unknown): value is Iterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function'
  );
}
