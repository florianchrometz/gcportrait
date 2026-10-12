// SPDX-License-Identifier: MIT
/**
 * The inputs ingest reads, and how each becomes a sequence of chunks. One *source* is one part (one file):
 * line numbers restart and a missing final newline is forgiven at its end. Several sources are passed as an
 * array (or any synchronous iterable) and read one after the other.
 */
import { IngestError } from './errors.js';
import {
  isAsyncIterable,
  isBlobLike,
  isByteStream,
  isIterable,
  type BlobLike,
  type ByteStream,
} from './platform.js';

/** A piece of input: bytes (UTF-8) or text. */
export type IngestChunk = Uint8Array | string;

/**
 * One input part: a whole string or byte array, a `Blob`/`File`, a `ReadableStream<Uint8Array>` (such as a
 * `fetch` Response body), or any async iterable of chunks (such as a Node readable stream).
 */
export type IngestSource = string | Uint8Array | BlobLike | ByteStream | AsyncIterable<IngestChunk>;

/** One source, or several (an array or other synchronous iterable of sources) read in order as separate parts. */
export type IngestInput = IngestSource | Iterable<IngestSource>;

/** Whether a value is a single source rather than a list of sources. */
export function isSingleSource(value: unknown): value is IngestSource {
  return (
    typeof value === 'string' ||
    value instanceof Uint8Array ||
    isByteStream(value) ||
    isBlobLike(value) ||
    isAsyncIterable(value)
  );
}

/** The sources of an input, in order. */
export function* sourcesOf(input: IngestInput): Generator<IngestSource> {
  const value: unknown = input;
  if (isSingleSource(value)) {
    yield value;
    return;
  }
  if (!isIterable(value)) {
    throw new IngestError(
      'invalid-source',
      'The input must be a string, a Uint8Array, a Blob, a ReadableStream, an async iterable of chunks, or a list of these.',
    );
  }
  for (const source of value) {
    if (!isSingleSource(source)) {
      throw new IngestError(
        'invalid-source',
        'Each source in a list must be a single source, not a nested list.',
      );
    }
    yield source;
  }
}

/** The chunks of one source, in order. A stream that is abandoned early is cancelled. */
export async function* chunksOf(source: IngestSource): AsyncGenerator<IngestChunk> {
  if (typeof source === 'string' || source instanceof Uint8Array) {
    yield source;
  } else if (isByteStream(source)) {
    yield* readStream(source);
  } else if (isBlobLike(source)) {
    yield* readStream(source.stream());
  } else {
    for await (const chunk of source) yield checkChunk(chunk);
  }
}

async function* readStream(stream: ByteStream): AsyncGenerator<IngestChunk> {
  const reader = stream.getReader();
  let drained = false;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) {
        drained = true;
        return;
      }
      yield checkChunk(result.value);
    }
  } finally {
    // The consumer stopped early (an error frame, strict mode) or the stream failed: release the producer.
    if (!drained) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function checkChunk(chunk: unknown): IngestChunk {
  if (typeof chunk === 'string' || chunk instanceof Uint8Array) return chunk;
  throw new IngestError(
    'invalid-source',
    'A source produced a chunk that is neither a Uint8Array nor a string.',
  );
}
