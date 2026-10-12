// SPDX-License-Identifier: MIT
/**
 * A Cloud Asset Inventory `assets.list` page turned into a `page` frame without parsing it (docs/security.md
 * "Response caps and memory").
 *
 * Until the security review of 2026-10-11 every page was decoded into a string, parsed and serialised again: about
 * three copies of the page on the JavaScript heap at once, which for a page at the 25 MiB cap is roughly 100 MiB of
 * heap, while V8 gives a process a heap of about a quarter of its memory by default. Measured with
 * `--max-old-space-size=128` (the heap a 512 MiB instance gets), four such pages at once ended the process with
 * "JavaScript heap out of memory".
 *
 * This scanner reads the page's bytes once and writes the frame into one buffer outside the heap:
 * `{"t":"page","assets":` + the `assets` array with every whitespace outside strings removed (Google's answers are
 * pretty-printed; a frame must be one line) + `}` and a line break. It reads `nextPageToken` and `readTime` (short
 * strings), counts the array's elements and checks what a frame needs: well-formed UTF-8, a top-level object,
 * balanced brackets, terminated strings without raw control characters, valid escapes, and `assets` an array (or
 * `null` or absent: an empty page), the two strings strings. It does not check every literal (`tru` would pass);
 * the browser parses each frame, and Google's answers are JSON. The values are the ones `JSON.parse` would give,
 * only their spelling may differ from `JSON.stringify`'s (escapes and numbers are kept as Google wrote them).
 */
import { Buffer, isUtf8 } from 'node:buffer';

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const COMMA = 0x2c;
const COLON = 0x3a;
const NEW_LINE = 0x0a;

const OBJECT = 1;
const ARRAY = 2;

/** The longest `nextPageToken` or `readTime` value read (both are short strings). */
const MAX_FIELD_BYTES = 64 * 1024;

const FRAME_START = new TextEncoder().encode('{"t":"page","assets":');
const FRAME_END = new TextEncoder().encode('}\n');
const EMPTY_ARRAY = new TextEncoder().encode('[]');

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === NEW_LINE || byte === 0x0d;
}

/** The characters a number, `true`, `false` or `null` is made of. */
function isLiteralByte(byte: number): boolean {
  return (
    (byte >= 0x30 && byte <= 0x39) ||
    (byte >= 0x61 && byte <= 0x7a) ||
    (byte >= 0x41 && byte <= 0x5a) ||
    byte === 0x2b ||
    byte === 0x2d ||
    byte === 0x2e
  );
}

function isHexDigit(byte: number): boolean {
  return (byte >= 0x30 && byte <= 0x39) || (byte >= 0x61 && byte <= 0x66) || (byte >= 0x41 && byte <= 0x46);
}

/** The escapes JSON allows after a backslash, besides `u`. */
const SIMPLE_ESCAPES = new Set([QUOTE, BACKSLASH, 0x2f, 0x62, 0x66, 0x6e, 0x72, 0x74]);

/** A page as its frame and what the stream needs of it. */
export interface ScannedListPage {
  /** The whole `page` frame line, `{"t":"page","assets":[…]}` and a line break, outside the JavaScript heap. */
  readonly frame: Uint8Array;
  /** The number of assets in it. */
  readonly count: number;
  readonly nextPageToken?: string;
  readonly readTime?: string;
}

/** A short JSON string value, decoded; undefined when the bytes are not one string. */
function shortString(bytes: Uint8Array): string | undefined {
  if (bytes.byteLength > MAX_FIELD_BYTES || bytes[0] !== QUOTE) return undefined;
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The `page` frame of an `assets.list` answer's body, or null when the body is not a page: not UTF-8, not a JSON
 * object, unbalanced, `assets` not an array, or `nextPageToken` or `readTime` not a string. An empty
 * `nextPageToken` or `readTime` counts as absent, as before.
 */
export function scanListPage(body: Uint8Array): ScannedListPage | null {
  if (!isUtf8(body)) return null;
  const prefix = FRAME_START.byteLength;
  // The minified page is written after room for the frame's start; the assets array is moved there at the end.
  const out = Buffer.allocUnsafe(prefix + body.byteLength + FRAME_END.byteLength);
  let o = prefix;
  const stack: number[] = [];
  let inString = false;
  let escaped = false;
  let hexLeft = 0;
  let started = false;
  let finished = false;
  // The top-level object's key and value being read.
  let expectKey = false;
  let keyStart = -1;
  let key: string | undefined;
  let valueStart = -1;
  // The assets array as found (last occurrence wins, as with JSON.parse).
  let assetsStart = -1;
  let assetsEnd = -1;
  let count = 0;
  let countingAssets = false;
  let assetsHasElement = false;
  const fields = new Map<string, Uint8Array>();

  const endValue = (): boolean => {
    // A top-level value ended at `o` (exclusive): keep what the frame needs.
    if (key === undefined || valueStart < 0) return false;
    const value = out.subarray(valueStart, o);
    if (key === 'assets') {
      const first = value[0];
      const isNull =
        value.byteLength === 4 &&
        value[0] === 0x6e &&
        value[1] === 0x75 &&
        value[2] === 0x6c &&
        value[3] === 0x6c;
      if (first !== OPEN_BRACKET && !isNull) return false;
      assetsStart = isNull ? -1 : valueStart;
      assetsEnd = isNull ? -1 : o;
      if (!isNull) count = assetsHasElement ? count : 0;
    } else if (key === 'nextPageToken' || key === 'readTime') {
      if (value[0] !== QUOTE) return false;
      fields.set(key, value);
    }
    key = undefined;
    valueStart = -1;
    countingAssets = false;
    return true;
  };

  for (let i = 0; i < body.byteLength; i += 1) {
    const byte = body[i] ?? 0;
    if (inString) {
      out[o] = byte;
      o += 1;
      if (hexLeft > 0) {
        if (!isHexDigit(byte)) return null;
        hexLeft -= 1;
      } else if (escaped) {
        if (byte === 0x75) hexLeft = 4;
        else if (!SIMPLE_ESCAPES.has(byte)) return null;
        escaped = false;
      } else if (byte === BACKSLASH) {
        escaped = true;
      } else if (byte === QUOTE) {
        inString = false;
        if (stack.length === 1 && keyStart >= 0) {
          key = shortString(out.subarray(keyStart, o));
          keyStart = -1;
          if (key === undefined) return null;
        }
      } else if (byte < 0x20) {
        return null;
      }
      continue;
    }
    if (isWhitespace(byte)) continue;
    if (finished) return null;
    const depth = stack.length;
    // In the top-level object a key (a string) or its end must come where a key is expected.
    if (depth === 1 && expectKey && byte !== QUOTE && byte !== CLOSE_BRACE) return null;
    // The first byte of a top-level value.
    if (depth === 1 && key !== undefined && valueStart < 0 && byte !== COLON) {
      valueStart = o;
      if (key === 'assets' && byte === OPEN_BRACKET) {
        countingAssets = true;
        count = 0;
        assetsHasElement = false;
      }
    }
    // The first byte of an element of the assets array.
    if (countingAssets && depth === 2 && byte !== CLOSE_BRACKET && byte !== COMMA && !assetsHasElement) {
      assetsHasElement = true;
      count = 1;
    }
    switch (byte) {
      case QUOTE:
        if (!started) return null;
        inString = true;
        if (depth === 1 && expectKey) {
          keyStart = o;
          expectKey = false;
        }
        break;
      case OPEN_BRACE:
      case OPEN_BRACKET:
        if (!started) {
          if (byte !== OPEN_BRACE) return null;
          started = true;
          expectKey = true;
        }
        stack.push(byte === OPEN_BRACE ? OBJECT : ARRAY);
        break;
      case CLOSE_BRACE:
      case CLOSE_BRACKET: {
        if (stack.pop() !== (byte === CLOSE_BRACE ? OBJECT : ARRAY)) return null;
        if (stack.length === 0) {
          if (valueStart >= 0 ? !endValue() : key !== undefined) return null;
          finished = true;
        }
        break;
      }
      case COMMA:
        if (depth === 0) return null;
        if (depth === 1) {
          if (valueStart < 0 || !endValue()) return null;
          expectKey = true;
        } else if (countingAssets && depth === 2) {
          count += 1;
        }
        break;
      case COLON:
        if (depth === 0) return null;
        break;
      default:
        if (!started || !isLiteralByte(byte)) return null;
    }
    out[o] = byte;
    o += 1;
  }
  if (!finished || inString) return null;

  const nextPageToken = shortString(fields.get('nextPageToken') ?? new Uint8Array(0));
  const readTime = shortString(fields.get('readTime') ?? new Uint8Array(0));
  if (fields.has('nextPageToken') && nextPageToken === undefined) return null;
  if (fields.has('readTime') && readTime === undefined) return null;

  // The frame: its start, the assets array moved to follow it, its end.
  out.set(FRAME_START, 0);
  let end: number;
  if (assetsStart >= 0) {
    out.copyWithin(prefix, assetsStart, assetsEnd);
    end = prefix + (assetsEnd - assetsStart);
  } else {
    out.set(EMPTY_ARRAY, prefix);
    end = prefix + EMPTY_ARRAY.byteLength;
    count = 0;
  }
  out.set(FRAME_END, end);
  return {
    frame: out.subarray(0, end + FRAME_END.byteLength),
    count,
    ...(nextPageToken === undefined || nextPageToken === '' ? {} : { nextPageToken }),
    ...(readTime === undefined || readTime === '' ? {} : { readTime }),
  };
}
