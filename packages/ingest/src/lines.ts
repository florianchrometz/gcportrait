// SPDX-License-Identifier: MIT
/**
 * The line splitter at the bottom of the reader. It takes chunks of bytes or text in any size, cut anywhere
 * (inside a line, between a CR and its LF, inside a multi-byte UTF-8 sequence), and hands complete lines to
 * a callback.
 *
 * Bytes are split on the LF byte before anything is decoded. UTF-8 never uses 0x0A inside a multi-byte
 * sequence, so a line's bytes are always complete and each line is decoded on its own; a sequence cut by a
 * chunk boundary is simply joined back when the line completes. Text chunks are split on `\n` directly.
 *
 * Per line: a trailing CR is dropped (CRLF files), a leading byte-order mark is dropped (at the start of a
 * file, and also where files were glued together with `cat`), and a line longer than the limit is skipped
 * without being buffered. Parts (files) are separated with {@link LineSplitter.endPart}: the trailing line
 * of a part is completed even without a final newline, and line numbers restart at 1.
 */
import { createUtf8Decoder, type Utf8Decoder } from './platform.js';

const LF = 0x0a;
const CR = 0x0d;
const BOM = 0xfeff;

/** The two problems the splitter itself can find. */
export type LineProblemCode = 'invalid-utf8' | 'line-too-long';

/** Receives the splitter's output, in input order. */
export interface LineHandlers {
  /** A complete line without its LF, CR or byte-order mark. Blank lines are passed on as `''`. */
  line(text: string, part: number, line: number): void;
  /** A line that could not be passed on. */
  problem(code: LineProblemCode, part: number, line: number, message: string): void;
}

/**
 * The number of bytes a string takes in UTF-8. Lone surrogates count as U+FFFD (three bytes), which is how
 * TextEncoder writes them.
 */
export function utf8ByteLength(text: string): number {
  let bytes = text.length;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0x80) continue;
    if (unit < 0x800) {
      bytes += 1;
    } else if (isHighSurrogate(unit) && isLowSurrogate(text.charCodeAt(index + 1))) {
      // A surrogate pair: two code units, four bytes.
      bytes += 2;
      index += 1;
    } else {
      bytes += 2;
    }
  }
  return bytes;
}

function isHighSurrogate(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff;
}

function isLowSurrogate(unit: number): boolean {
  return unit >= 0xdc00 && unit <= 0xdfff;
}

export class LineSplitter {
  readonly #handlers: LineHandlers;
  readonly #maxLineBytes: number;
  #decoder: Utf8Decoder | undefined;
  /** The start of the current line, when it spans chunks. */
  #segments: (Uint8Array | string)[] = [];
  #pendingSize = 0;
  /** The current line is over the limit: drop its content until the next LF. */
  #overflow = false;
  #part = 0;
  #line = 0;
  #bytes = 0;
  /** The last text chunk ended with a high surrogate. */
  #highSurrogateEnd = false;

  /**
   * @param maxLineBytes the longest line passed on, in bytes (for text chunks: UTF-16 code units), not
   *   counting the LF.
   */
  constructor(handlers: LineHandlers, maxLineBytes: number) {
    this.#handlers = handlers;
    this.#maxLineBytes = maxLineBytes;
  }

  /** Raw input size so far, in bytes (text chunks are counted as their UTF-8 length). */
  get bytes(): number {
    return this.#bytes;
  }

  /** The number of parts ended so far, which is also the index of the current part. */
  get part(): number {
    return this.#part;
  }

  /** Whether the current part has an incomplete line waiting for more input. */
  get pending(): boolean {
    return this.#segments.length > 0 || this.#overflow;
  }

  push(chunk: Uint8Array | string): void {
    if (chunk.length === 0) return;
    if (typeof chunk === 'string') {
      this.#bytes += utf8ByteLength(chunk);
      // A surrogate pair cut between two text chunks was counted as two lone surrogates (3 + 3 bytes); it is
      // one four-byte character.
      if (this.#highSurrogateEnd && isLowSurrogate(chunk.charCodeAt(0))) this.#bytes -= 2;
      this.#highSurrogateEnd = isHighSurrogate(chunk.charCodeAt(chunk.length - 1));
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf('\n', start);
        if (newline === -1) {
          this.#append(chunk.slice(start), chunk.length - start);
          return;
        }
        this.#complete(chunk.slice(start, newline), newline - start);
        start = newline + 1;
      }
    } else {
      this.#bytes += chunk.byteLength;
      this.#highSurrogateEnd = false;
      let start = 0;
      while (start < chunk.length) {
        const newline = chunk.indexOf(LF, start);
        if (newline === -1) {
          // Copy the tail: the caller may reuse its buffer once push() returns.
          this.#append(chunk.slice(start), chunk.length - start);
          return;
        }
        this.#complete(chunk.subarray(start, newline), newline - start);
        start = newline + 1;
      }
    }
  }

  /** Ends the current part: completes its last line even without a final LF and restarts line numbers. */
  endPart(): void {
    if (this.pending) this.#complete(undefined, 0);
    this.#part += 1;
    this.#line = 0;
    this.#highSurrogateEnd = false;
  }

  #append(segment: Uint8Array | string, size: number): void {
    if (this.#overflow || size === 0) return;
    if (this.#pendingSize + size > this.#maxLineBytes) {
      this.#overflow = true;
      this.#segments = [];
      this.#pendingSize = 0;
      return;
    }
    this.#segments.push(segment);
    this.#pendingSize += size;
  }

  /** Completes the current line with its last segment (`undefined` at the end of a part). */
  #complete(last: Uint8Array | string | undefined, size: number): void {
    this.#line += 1;
    const tooLong = this.#overflow || this.#pendingSize + size > this.#maxLineBytes;
    const segments = this.#segments;
    this.#segments = [];
    this.#pendingSize = 0;
    this.#overflow = false;
    if (tooLong) {
      this.#handlers.problem(
        'line-too-long',
        this.#part,
        this.#line,
        `The line is longer than ${String(this.#maxLineBytes)} bytes; it was skipped.`,
      );
      return;
    }
    if (last !== undefined) segments.push(last);
    if (segments.every((segment) => typeof segment !== 'string')) {
      this.#emitBytes(concatBytes(segments));
      return;
    }
    // Text and bytes mixed in one line (a source that yields both): decode each run of byte segments.
    const pieces: string[] = [];
    let run: Uint8Array[] = [];
    for (const segment of [...segments, '']) {
      if (typeof segment !== 'string') {
        run.push(segment);
        continue;
      }
      if (run.length > 0) {
        const text = this.#tryDecode(concatBytes(run));
        if (text === undefined) return;
        pieces.push(text);
        run = [];
      }
      pieces.push(segment);
    }
    this.#emitText(pieces.join(''));
  }

  /** Decodes a line's bytes, reporting `invalid-utf8` and returning undefined when they are not UTF-8. */
  #tryDecode(bytes: Uint8Array): string | undefined {
    this.#decoder ??= createUtf8Decoder();
    try {
      return this.#decoder.decode(bytes);
    } catch {
      this.#handlers.problem('invalid-utf8', this.#part, this.#line, 'The line is not valid UTF-8.');
      return undefined;
    }
  }

  #emitText(text: string): void {
    let start = 0;
    let end = text.length;
    if (end > 0 && text.charCodeAt(end - 1) === CR) end -= 1;
    if (end > 0 && text.charCodeAt(0) === BOM) start = 1;
    this.#handlers.line(
      start === 0 && end === text.length ? text : text.slice(start, end),
      this.#part,
      this.#line,
    );
  }

  #emitBytes(bytes: Uint8Array): void {
    let start = 0;
    let end = bytes.length;
    if (end > 0 && bytes[end - 1] === CR) end -= 1;
    if (end >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3;
    if (start === end) {
      this.#handlers.line('', this.#part, this.#line);
      return;
    }
    const text = this.#tryDecode(bytes.subarray(start, end));
    if (text !== undefined) this.#handlers.line(text, this.#part, this.#line);
  }
}

function concatBytes(segments: readonly Uint8Array[]): Uint8Array {
  const [first] = segments;
  if (segments.length === 1 && first !== undefined) return first;
  let size = 0;
  for (const segment of segments) size += segment.length;
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const segment of segments) {
    joined.set(segment, offset);
    offset += segment.length;
  }
  return joined;
}
