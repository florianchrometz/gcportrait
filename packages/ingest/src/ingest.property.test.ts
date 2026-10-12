// SPDX-License-Identifier: MIT
/**
 * Property tests: however an NDJSON document is cut into chunks (bytes at any offset, so also inside a
 * multi-byte sequence or between CR and LF; or text at any code unit), ingest sees the same document.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ingest } from './ingest.js';
import { normaliseAsset } from './normalise.js';
import { exportShape, iterate, numberedAsset, splitAt, testOptions, utf8 } from './testing/helpers.js';

/**
 * A raw asset with a unique name, a payload of arbitrary JSON (any Unicode) and an update time, in the
 * `assets.list` key style or the `exportAssets` file style.
 */
const assetArbitrary = (index: number) =>
  fc
    .record({
      label: fc.string({ unit: 'grapheme', maxLength: 12 }),
      payload: fc.jsonValue({ maxDepth: 3 }),
      time: fc.integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2030, 0, 1) }),
      exported: fc.boolean(),
    })
    .map(({ label, payload, time, exported }) => {
      const asset = numberedAsset(index, new Date(time).toISOString());
      const raw = { ...asset, resource: { data: { label, payload } } };
      return exported ? exportShape(raw) : raw;
    });

/** A line: an asset, a page frame of assets, a progress frame, a blank line or garbage. */
type Line = { kind: 'asset'; value: Record<string, unknown> } | { kind: 'text'; value: string };

const documentArbitrary = fc
  .record({
    lineCount: fc.integer({ min: 0, max: 10 }),
    bom: fc.boolean(),
    crlf: fc.array(fc.boolean(), { minLength: 10, maxLength: 10 }),
    finalNewline: fc.boolean(),
    garbage: fc.boolean(),
  })
  .chain(({ lineCount, bom, crlf, finalNewline, garbage }) =>
    fc
      .tuple(
        ...Array.from({ length: lineCount }, (_, index) =>
          fc.oneof(
            { weight: 4, arbitrary: assetArbitrary(index).map((value): Line => ({ kind: 'asset', value })) },
            {
              weight: 1,
              arbitrary: fc
                .tuple(assetArbitrary(100 + index), assetArbitrary(200 + index))
                .map((assets): Line => ({ kind: 'text', value: JSON.stringify({ t: 'page', assets }) })),
            },
            {
              weight: 1,
              arbitrary: fc.constant<Line>({ kind: 'text', value: '{"t":"progress","pages":1,"assets":2}' }),
            },
            {
              weight: 1,
              arbitrary: fc.constantFrom<Line>({ kind: 'text', value: '' }, { kind: 'text', value: ' \t ' }),
            },
            {
              weight: garbage ? 1 : 0,
              arbitrary: fc
                .string({ unit: 'grapheme', minLength: 1, maxLength: 20 })
                .filter((text) => !text.includes('\n'))
                .map((value): Line => ({ kind: 'text', value })),
            },
          ),
        ),
      )
      .map((lines) => {
        const texts = lines.map((line) => (line.kind === 'asset' ? JSON.stringify(line.value) : line.value));
        const body = texts.map((text, index) => text + (crlf[index] === true ? '\r\n' : '\n')).join('');
        const trimmed = finalNewline || body.length === 0 ? body : body.replace(/\r?\n$/, '');
        return { text: (bom ? '\uFEFF' : '') + trimmed, lines };
      }),
  );

describe('chunking does not matter', () => {
  it('gives the same snapshot and report for any byte cut points', async () => {
    await fc.assert(
      fc.asyncProperty(documentArbitrary, fc.array(fc.nat(), { maxLength: 40 }), async ({ text }, cuts) => {
        const bytes = utf8(text);
        const whole = await ingest(bytes, testOptions());
        const pieces = splitAt(
          bytes,
          cuts.map((cut) => cut % (bytes.length + 1)),
        );
        expect(await ingest(iterate(pieces), testOptions())).toEqual(whole);
      }),
    );
  });

  it('gives the same snapshot and report for any text cut points, surrogate pairs included', async () => {
    await fc.assert(
      fc.asyncProperty(documentArbitrary, fc.array(fc.nat(), { maxLength: 40 }), async ({ text }, cuts) => {
        const whole = await ingest(utf8(text), testOptions());
        const offsets = [...new Set(cuts.map((cut) => cut % (text.length + 1)))].sort(
          (left, right) => left - right,
        );
        const pieces = [0, ...offsets].map((start, index) =>
          text.slice(start, offsets[index] ?? text.length),
        );
        expect(await ingest(iterate(pieces), testOptions())).toEqual(whole);
      }),
    );
  });

  it('yields exactly the generated assets, normalised, in order', async () => {
    await fc.assert(
      fc.asyncProperty(
        documentArbitrary,
        fc.array(fc.nat(), { maxLength: 40 }),
        async ({ text, lines }, cuts) => {
          const bytes = utf8(text);
          const { snapshot } = await ingest(
            iterate(
              splitAt(
                bytes,
                cuts.map((cut) => cut % (bytes.length + 1)),
              ),
            ),
            testOptions(),
          );
          const expected = lines.flatMap((line) => {
            // What the document says: JSON has no -0, so the generated values go through JSON first.
            if (line.kind === 'asset') return [JSON.parse(JSON.stringify(line.value)) as unknown];
            if (line.value.startsWith('{"t":"page"'))
              return (JSON.parse(line.value) as { assets: unknown[] }).assets;
            return [];
          });
          expect(snapshot.assets).toEqual(
            expected.map((raw) => (normaliseAsset(raw) as { asset: unknown }).asset),
          );
          expect(snapshot.stats.bytes).toBe(bytes.length);
        },
      ),
    );
  });
});
