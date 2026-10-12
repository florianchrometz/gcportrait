// SPDX-License-Identifier: MIT
/**
 * The page scanner (list-page.ts): a page's frame built from its bytes must mean exactly what
 * `JSON.parse` of the page means (the same assets, count, `nextPageToken` and `readTime`), be one line, and refuse
 * what is not a page. Every value is synthetic.
 */
import { describe, expect, it } from 'vitest';

import { syntheticPages } from './google.testing.js';
import { scanListPage, type ScannedListPage } from './list-page.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function scan(text: string | Uint8Array): ScannedListPage | null {
  return scanListPage(typeof text === 'string' ? encoder.encode(text) : text);
}

function frameOf(text: string): unknown {
  const scanned = scan(text);
  if (scanned === null) throw new Error('not a page');
  const line = decoder.decode(scanned.frame);
  expect(line.endsWith('\n')).toBe(true);
  expect(line.slice(0, -1)).not.toContain('\n');
  return JSON.parse(line);
}

/** A deterministic pseudo-random sequence (mulberry32), so the generated pages are the same on every run. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const AWKWARD_STRINGS = [
  '',
  'plain',
  'with "quotes" and \\ backslashes',
  'brackets [ ] { } , : in text',
  'line\nbreak\r\tand tab',
  'unicode é ü ß 東京 🙂',
  '   separators',
  '\u0000\u001f control escapes',
  '//compute.googleapis.com/projects/demo-app-1/zones/europe-west3-a/instances/vm-1',
];

function value(next: () => number, depth: number): unknown {
  const pick = Math.floor(next() * (depth > 3 ? 5 : 7));
  switch (pick) {
    case 0:
      return AWKWARD_STRINGS[Math.floor(next() * AWKWARD_STRINGS.length)];
    case 1:
      return Math.round((next() - 0.5) * 1e6) / 100;
    case 2:
      return next() < 0.5;
    case 3:
      return null;
    case 4:
      return Math.floor(next() * 1e12);
    case 5:
      return Array.from({ length: Math.floor(next() * 4) }, () => value(next, depth + 1));
    default:
      return Object.fromEntries(
        Array.from({ length: Math.floor(next() * 4) }, (_, index) => [
          `${AWKWARD_STRINGS[index % AWKWARD_STRINGS.length] ?? ''}${String(index)}`,
          value(next, depth + 1),
        ]),
      );
  }
}

describe('scanListPage', () => {
  it('turns a pretty-printed page into the frame JSON.parse would give, on one line', () => {
    const [assets = []] = syntheticPages(3, 3);
    const page = { readTime: '2026-10-08T12:00:00.123456Z', assets, nextPageToken: 'page-1' };
    const scanned = scan(JSON.stringify(page, null, 2));
    expect(scanned).not.toBeNull();
    expect(scanned?.count).toBe(3);
    expect(scanned?.nextPageToken).toBe('page-1');
    expect(scanned?.readTime).toBe('2026-10-08T12:00:00.123456Z');
    expect(frameOf(JSON.stringify(page, null, 2))).toEqual({ t: 'page', assets });
  });

  it('writes exactly the bytes JSON.stringify writes for a page Google sent minified', () => {
    const [assets = []] = syntheticPages(500);
    const scanned = scan(JSON.stringify({ assets, nextPageToken: 'page-1', readTime: 'x' }));
    expect(decoder.decode(scanned?.frame)).toBe(`${JSON.stringify({ t: 'page', assets })}\n`);
    expect(scanned?.count).toBe(500);
  });

  it('keeps every value of 300 generated pages, whatever their spelling and whitespace', () => {
    const next = random(20261011);
    for (let run = 0; run < 300; run += 1) {
      const assets = Array.from({ length: Math.floor(next() * 6) }, () => value(next, 1));
      const page: Record<string, unknown> = { assets };
      if (next() < 0.5) page.nextPageToken = `token-${String(run)}`;
      if (next() < 0.5) page.readTime = '2026-10-08T12:00:00Z';
      if (next() < 0.3) page.other = value(next, 1);
      const indent = [0, 1, 2, '\t', ' \n '][Math.floor(next() * 5)];
      const text = JSON.stringify(page, null, indent);
      const scanned = scan(text);
      expect(scanned, text).not.toBeNull();
      expect(JSON.parse(decoder.decode(scanned?.frame)), text).toEqual({ t: 'page', assets });
      expect(scanned?.count, text).toBe(assets.length);
      expect(scanned?.nextPageToken, text).toBe(page.nextPageToken);
      expect(scanned?.readTime, text).toBe(page.readTime);
    }
  });

  it('keeps escapes as Google wrote them, which parse to the same values', () => {
    const text =
      '{"assets":[{"name":"caf\\u00e9 \\/ \\"x\\"","n":1.50e2,"list":[ [ ], { } ]}],"readTime":"t\\u0031"}';
    expect(frameOf(text)).toEqual({ t: 'page', assets: [{ name: 'café / "x"', n: 150, list: [[], {}] }] });
    expect(scan(text)?.readTime).toBe('t1');
  });

  it('reads the fields wherever they stand, and the last of a repeated key', () => {
    const text = '{ "nextPageToken" : "a", "assets": [1], "assets": [2, 3], "nextPageToken": "b" }';
    const scanned = scan(text);
    expect(scanned?.count).toBe(2);
    expect(scanned?.nextPageToken).toBe('b');
    expect(frameOf(text)).toEqual({ t: 'page', assets: [2, 3] });
  });

  it.each([
    ['no assets key', '{"readTime":"2026-10-08T12:00:00Z"}'],
    ['an empty array', '{"assets":[ ]}'],
    ['null', '{"assets":null}'],
    ['an empty object', '{}'],
  ])('reads %s as an empty page', (_name, text) => {
    const scanned = scan(text);
    expect(scanned?.count).toBe(0);
    expect(decoder.decode(scanned?.frame)).toBe('{"t":"page","assets":[]}\n');
  });

  it('treats an empty nextPageToken or readTime as absent', () => {
    const scanned = scan('{"assets":[],"nextPageToken":"","readTime":""}');
    expect(scanned).toEqual({ frame: expect.any(Uint8Array) as unknown, count: 0 });
  });

  it.each([
    ['empty', ''],
    ['whitespace', '  \n'],
    ['an array', '[{"assets":[]}]'],
    ['a string', '"assets"'],
    ['unbalanced', '{"assets":[{"a":1}]'],
    ['mismatched', '{"assets":[}]}'],
    ['an unterminated string', '{"assets":["abc]}'],
    ['a raw line break in a string', '{"assets":["a\nb"]}'],
    ['a bad escape', '{"assets":["\\x41"]}'],
    ['a bad unicode escape', '{"assets":["\\u12g4"]}'],
    ['assets an object', '{"assets":{"a":1}}'],
    ['assets a string', '{"assets":"[]"}'],
    ['nextPageToken a number', '{"assets":[],"nextPageToken":5}'],
    ['readTime an object', '{"assets":[],"readTime":{}}'],
    ['something after the object', '{"assets":[]} {}'],
    ['a key without a value', '{"assets"}'],
    ['a value where a key belongs', '{1:2}'],
    ['a stray comma', '{,"assets":[]}'],
    ['a stray character', '{"assets":[1 # 2]}'],
  ])('refuses %s', (_name, text) => {
    expect(scan(text)).toBeNull();
  });

  it('refuses bytes that are not UTF-8', () => {
    expect(scan(new Uint8Array([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]))).toBeNull();
  });

  it('builds the frame outside the JavaScript heap, in one buffer no larger than the page', () => {
    const [assets = []] = syntheticPages(500);
    const body = encoder.encode(JSON.stringify({ assets }, null, 2));
    const scanned = scan(body);
    expect(Buffer.isBuffer(scanned?.frame)).toBe(true);
    expect(scanned?.frame.buffer.byteLength).toBeLessThanOrEqual(body.byteLength + 64);
  });
});
