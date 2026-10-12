// SPDX-License-Identifier: MIT
import { SnapshotSchema } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { IngestError, type IngestProblem } from './errors.js';
import { ingest, readLines, type TextLine } from './ingest.js';
import type { ByteStream } from './platform.js';
import type { IngestSource } from './sources.js';
import { byteStream, chunked, iterate, ndjson, numberedAsset, testOptions, utf8 } from './testing/helpers.js';

const input = ndjson([numberedAsset(1), numberedAsset(2), numberedAsset(3)]);
const bytes = utf8(input);

async function names(source: Parameters<typeof ingest>[0]): Promise<string[]> {
  const { snapshot } = await ingest(source, testOptions());
  return snapshot.assets.map((asset) => asset.name.split('/').pop() ?? '');
}

describe('ingest sources', () => {
  it.each<[string, () => IngestSource]>([
    ['a string', () => input],
    ['a Uint8Array', () => bytes],
    ['a byte stream', () => byteStream(chunked(bytes, 7))],
    ['a blob', () => ({ size: bytes.length, stream: () => byteStream(chunked(bytes, 64)) })],
    ['an async iterable of byte chunks', () => iterate(chunked(bytes, 5))],
    ['an async iterable of text chunks', () => iterate([input.slice(0, 10), input.slice(10)])],
  ])('reads %s', async (_name, source) => {
    expect(await names(source())).toEqual(['net-1', 'net-2', 'net-3']);
  });

  it('reads a list of sources as separate parts', async () => {
    const first = JSON.stringify(numberedAsset(1)); // no final newline
    const { snapshot, report } = await ingest(
      [first, utf8(ndjson([numberedAsset(2)])), byteStream([utf8(ndjson([numberedAsset(3)]))])],
      testOptions(),
    );
    expect(snapshot.stats.count).toBe(3);
    expect(report.parts).toBe(3);
    expect(SnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('reads a generator of sources', async () => {
    function* parts(): Generator<string> {
      yield ndjson([numberedAsset(1)]);
      yield ndjson([numberedAsset(2)]);
    }
    expect(await names(parts())).toEqual(['net-1', 'net-2']);
  });

  it('counts an empty list as no parts', async () => {
    const { snapshot, report } = await ingest([], testOptions());
    expect(snapshot.stats.count).toBe(0);
    expect(report.parts).toBe(0);
  });

  it.each([
    ['a number', 42],
    ['null', null],
    ['a plain object', { size: 3 }],
    ['a nested list', [['a']]],
  ])('rejects %s as input', async (_name, value) => {
    await expect(ingest(value as unknown as IngestSource, testOptions())).rejects.toMatchObject({
      code: 'invalid-source',
    });
  });

  it.each([
    ['a stream', () => byteStream([utf8('x'), 42])],
    ['an async iterable', () => iterate<unknown>(['x', { not: 'a chunk' }]) as AsyncIterable<string>],
  ])('rejects %s that yields something other than bytes or text', async (_name, source) => {
    await expect(ingest(source(), testOptions())).rejects.toMatchObject({ code: 'invalid-source' });
  });

  it('cancels and releases a stream when an error frame stops the ingest early', async () => {
    const stream = byteStream([
      utf8(ndjson([{ t: 'error', message: 'quota exceeded' }])),
      utf8(ndjson([numberedAsset(1)])),
    ]);
    await expect(ingest(stream, testOptions())).rejects.toMatchObject({
      code: 'upstream',
      message: 'quota exceeded',
    });
    expect(stream.cancelled).toBe(true);
    expect(stream.released).toBe(true);
  });

  it('keeps the original error when cancelling the stream fails too', async () => {
    const stream = byteStream([utf8(ndjson([{ t: 'error', message: 'quota exceeded' }]))]);
    const reader = stream.getReader();
    const failing: ByteStream = {
      getReader: () => ({ ...reader, cancel: () => Promise.reject(new Error('already closed')) }),
    };
    await expect(ingest(failing, testOptions())).rejects.toMatchObject({
      code: 'upstream',
      message: 'quota exceeded',
    });
    expect(stream.released).toBe(true);
  });

  it('releases without cancelling a stream that was read to the end', async () => {
    const stream = byteStream([bytes]);
    await ingest(stream, testOptions());
    expect(stream.cancelled).toBe(false);
    expect(stream.released).toBe(true);
  });

  it('rejects in strict mode at the first bad line', async () => {
    await expect(ingest(`${input}oops\n`, testOptions({ strict: true }))).rejects.toBeInstanceOf(IngestError);
  });

  it('rejects invalid options before reading anything', async () => {
    const stream = byteStream([bytes]);
    await expect(ingest(stream, testOptions({ maxLineBytes: -1 }))).rejects.toMatchObject({
      code: 'invalid-options',
    });
    expect(stream.released).toBe(false);
  });
});

describe('readLines', () => {
  async function collect(
    source: Parameters<typeof readLines>[0],
    options?: Parameters<typeof readLines>[1],
  ): Promise<TextLine[]> {
    const lines: TextLine[] = [];
    for await (const line of readLines(source, options)) lines.push(line);
    return lines;
  }

  it('yields every non-blank line with its part and line number', async () => {
    const lines = await collect([utf8('\uFEFFa\r\n\n  \nb'), iterate(['c\n', 'd'])]);
    expect(lines).toEqual([
      { part: 0, line: 1, text: 'a' },
      { part: 0, line: 4, text: 'b' },
      { part: 1, line: 1, text: 'c' },
      { part: 1, line: 2, text: 'd' },
    ]);
  });

  it('streams: a line is yielded before the rest of the input is read', async () => {
    const seen: string[] = [];
    async function* source(): AsyncGenerator<string> {
      await Promise.resolve();
      seen.push('chunk 1');
      yield 'first\nsec';
      seen.push('chunk 2');
      yield 'ond\n';
    }
    for await (const line of readLines(source())) seen.push(line.text);
    expect(seen).toEqual(['chunk 1', 'first', 'chunk 2', 'second']);
  });

  it('rejects at a bad line, after yielding the lines before it', async () => {
    const yielded: string[] = [];
    const run = async () => {
      for await (const line of readLines(utf8(`a\nb\n${'x'.repeat(20)}\nc\n`), { maxLineBytes: 10 })) {
        yielded.push(line.text);
      }
    };
    await expect(run()).rejects.toMatchObject({
      code: 'malformed',
      problem: { code: 'line-too-long', line: 3 },
    });
    expect(yielded).toEqual(['a', 'b']);
  });

  it('passes bad lines to onProblem and goes on', async () => {
    const problems: IngestProblem[] = [];
    const lines = await collect([new Uint8Array([0x61, 0x0a, 0xc3, 0x28, 0x0a, 0x62])], {
      onProblem: (problem) => problems.push(problem),
    });
    expect(lines.map((line) => line.text)).toEqual(['a', 'b']);
    expect(problems).toEqual([
      { code: 'invalid-utf8', part: 0, line: 2, message: 'The line is not valid UTF-8.' },
    ]);
  });

  it('rejects an invalid line limit', async () => {
    await expect(collect('a', { maxLineBytes: 0 })).rejects.toMatchObject({ code: 'invalid-options' });
  });
});
