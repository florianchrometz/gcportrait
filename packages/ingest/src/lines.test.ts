// SPDX-License-Identifier: MIT
import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LineSplitter, utf8ByteLength, type LineProblemCode } from './lines.js';
import { chunked, joinBytes, splitAt, utf8 } from './testing/helpers.js';

interface Collected {
  lines: [part: number, line: number, text: string][];
  problems: [code: LineProblemCode, part: number, line: number][];
}

/** Runs the splitter over parts (each a list of chunks) and collects everything it emits. */
function split(
  parts: readonly (readonly (Uint8Array | string)[])[],
  maxLineBytes = 1024,
): Collected & { bytes: number } {
  const collected: Collected = { lines: [], problems: [] };
  const splitter = new LineSplitter(
    {
      line: (text, part, line) => collected.lines.push([part, line, text]),
      problem: (code, part, line) => collected.problems.push([code, part, line]),
    },
    maxLineBytes,
  );
  for (const chunks of parts) {
    for (const chunk of chunks) splitter.push(chunk);
    splitter.endPart();
  }
  return { ...collected, bytes: splitter.bytes };
}

const texts = (collected: Collected): string[] => collected.lines.map(([, , text]) => text);

describe('LineSplitter', () => {
  it.each([
    ['LF', 'a\nb\nc\n', ['a', 'b', 'c']],
    ['CRLF', 'a\r\nb\r\nc\r\n', ['a', 'b', 'c']],
    ['mixed LF and CRLF', 'a\r\nb\nc\r\n', ['a', 'b', 'c']],
    ['no final newline', 'a\nb', ['a', 'b']],
    ['a final CR without LF', 'a\nb\r', ['a', 'b']],
    ['blank lines', '\na\n\n\nb\n', ['', 'a', '', '', 'b']],
    ['a BOM at the start', '\uFEFFa\nb\n', ['a', 'b']],
    ['a BOM at the start of a later line (files glued with cat)', 'a\n\uFEFFb\n', ['a', 'b']],
    ['a BOM only', '\uFEFF', ['']],
    ['a BOM and CRLF on an empty line', '\uFEFF\r\n', ['']],
    ['a BOM inside a line, which is kept', 'a\uFEFFb\n', ['a\uFEFFb']],
    ['an empty input', '', []],
    ['multi-byte characters', 'Zürich – 東京 ✓ 🙂\n', ['Zürich – 東京 ✓ 🙂']],
  ])('splits %s', (_name, input, expected) => {
    expect(texts(split([[utf8(input)]]))).toEqual(expected);
    expect(texts(split([[input]]))).toEqual(expected);
  });

  it('gives the same lines for every way of cutting the bytes into chunks', () => {
    const input = utf8('\uFEFF{"a":"Zürich"}\r\n\r\n{"b":"東京 🙂"}\n{"c":1}');
    const expected = ['{"a":"Zürich"}', '', '{"b":"東京 🙂"}', '{"c":1}'];
    for (let size = 1; size <= input.length; size += 1) {
      expect(texts(split([chunked(input, size)]))).toEqual(expected);
    }
    // A cut between a CR and its LF, and inside a four-byte sequence.
    const cr = input.indexOf(0x0d);
    const emoji = input.indexOf(0xf0);
    expect(texts(split([splitAt(input, [cr + 1, emoji + 1, emoji + 2, emoji + 3])]))).toEqual(expected);
  });

  it('numbers lines from 1 per part, counting blank lines', () => {
    const { lines } = split([[utf8('a\n\nb\n')], [utf8('c\nd')]]);
    expect(lines).toEqual([
      [0, 1, 'a'],
      [0, 2, ''],
      [0, 3, 'b'],
      [1, 1, 'c'],
      [1, 2, 'd'],
    ]);
  });

  it('completes a part without a final newline instead of joining it to the next part', () => {
    expect(texts(split([[utf8('{"a":1}')], [utf8('{"b":2}\n')]]))).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('counts the raw input bytes, BOM, CR and blank lines included', () => {
    expect(split([[utf8('\uFEFFa\r\n\nb')]]).bytes).toBe(3 + 3 + 1 + 1);
    expect(split([['\uFEFFa\r\n\nb']]).bytes).toBe(8);
    expect(split([['é'], [utf8('é')]]).bytes).toBe(4);
  });

  it('counts a surrogate pair cut between text chunks as one four-byte character', () => {
    expect(split([['a\uD83D', '', '\uDE42b']]).bytes).toBe(6);
    expect(texts(split([['a\uD83D', '', '\uDE42b']]))).toEqual(['a\uD83D\uDE42b']);
    // Lone surrogates in different files stay lone (three bytes each, as TextEncoder writes them).
    expect(split([['\uD83D'], ['\uDE42']]).bytes).toBe(6);
  });

  it('skips a line longer than the limit without buffering it and goes on', () => {
    const long = 'x'.repeat(100);
    for (const size of [1, 7, 64, 1000]) {
      const result = split([chunked(utf8(`a\n${long}\nb\n${long}`), size)], 50);
      expect(texts(result)).toEqual(['a', 'b']);
      expect(result.problems).toEqual([
        ['line-too-long', 0, 2],
        ['line-too-long', 0, 4],
      ]);
    }
  });

  it('accepts a line of exactly the limit', () => {
    expect(texts(split([[utf8(`${'y'.repeat(50)}\n`)]], 50))).toEqual(['y'.repeat(50)]);
    expect(split([[`${'y'.repeat(51)}\n`]], 50).problems).toEqual([['line-too-long', 0, 1]]);
  });

  it('reports invalid UTF-8 and goes on', () => {
    const result = split([[joinBytes([utf8('a\n'), new Uint8Array([0xff, 0xfe, 0x0a]), utf8('b\n')])]]);
    expect(texts(result)).toEqual(['a', 'b']);
    expect(result.problems).toEqual([['invalid-utf8', 0, 2]]);
  });

  it('reports a multi-byte sequence cut off by the end of a part', () => {
    const result = split([[utf8('ok\n'), new Uint8Array([0xe6, 0x9d])], [utf8('next\n')]]);
    expect(texts(result)).toEqual(['ok', 'next']);
    expect(result.problems).toEqual([['invalid-utf8', 0, 2]]);
  });

  it('joins a line made of text and byte chunks', () => {
    const bytes = utf8('東京');
    expect(texts(split([['{"a":"', bytes.slice(0, 2), bytes.slice(2), '"}\r', utf8('\n')]]))).toEqual([
      '{"a":"東京"}',
    ]);
    expect(texts(split([[utf8('\uFEFF'), 'x\n']]))).toEqual(['x']);
  });

  it('reports a mixed line whose byte run is not UTF-8', () => {
    const result = split([[new Uint8Array([0xe6]), 'x\n', 'y\n']]);
    expect(texts(result)).toEqual(['y']);
    expect(result.problems).toEqual([['invalid-utf8', 0, 1]]);
  });

  it('does not keep references to the caller’s buffer for an unfinished line', () => {
    const lines: string[] = [];
    const splitter = new LineSplitter({ line: (text) => lines.push(text), problem: () => undefined }, 100);
    const buffer = utf8('abc');
    splitter.push(buffer);
    buffer.fill(0x21);
    splitter.push(utf8('\n'));
    expect(lines).toEqual(['abc']);
  });
});

describe('LineSplitter without TextDecoder', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('still splits text, and refuses bytes with a clear error', () => {
    vi.stubGlobal('TextDecoder', undefined);
    expect(texts(split([['a\nb\n']]))).toEqual(['a', 'b']);
    expect(() => split([[utf8('a\n')]])).toThrow(/TextDecoder is not available/);
  });
});

describe('utf8ByteLength', () => {
  // About 1.3 s on an idle machine and over 5 s under parallel load, so it gets its own timeout rather than
  // fewer runs: this property guards the ingest hot path.
  it('matches TextEncoder for any string, lone surrogates included', { timeout: 30_000 }, () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        expect(utf8ByteLength(text)).toBe(utf8(text).length);
      }),
    );
    expect(utf8ByteLength('\uD800x\uDC00')).toBe(utf8('\uD800x\uDC00').length);
  });
});
