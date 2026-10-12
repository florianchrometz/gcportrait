// @vitest-environment node
// SPDX-License-Identifier: MIT
import { SnapshotFormatError } from '@gcportrait/model';
import { beforeAll, describe, expect, it } from 'vitest';

import { BUNDLE_FORMAT, bundleFileName, bundleParts, isBundle } from '../bundle';
import { encodeJson, plainBlob } from '../codec';
import { demoHistory, demoSnapshot } from '../../diagram/pipeline/demo';
import { parseBundle, parseHistory, parseHistoryOf, SnapshotFileError } from './parse';

const history = demoHistory('S');
let snapshot: Awaited<ReturnType<typeof demoSnapshot>>;
let text: string;

async function bundleText(withHistory: boolean): Promise<string> {
  const parts = bundleParts(
    '2026-10-10T12:00:00.000Z',
    await plainBlob(await encodeJson(snapshot)),
    withHistory ? await plainBlob(await encodeJson(history)) : undefined,
  );
  return new Blob(parts).text();
}

function rewrite(change: (bundle: Record<string, unknown>) => void): string {
  const bundle = JSON.parse(text) as Record<string, unknown>;
  change(bundle);
  return JSON.stringify(bundle);
}

beforeAll(async () => {
  snapshot = await demoSnapshot(history);
  text = await bundleText(true);
});

describe('the .gcportrait.json bundle', () => {
  it('starts with its format key and carries no non-affiliation line (ADR 0018: never with an export)', () => {
    expect(text.startsWith(`{"format":"${BUNDLE_FORMAT}","version":1,`)).toBe(true);
    const bundle = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(bundle)).toEqual([
      'format',
      'version',
      'exportedAt',
      'generator',
      'snapshot',
      'history',
    ]);
    expect(bundle['generator']).toBe('gcportrait');
    expect(text.slice(0, text.indexOf('"snapshot"'))).not.toMatch(/affiliated/i);
  });

  it('reads a bundle written before 2026-10-12, with the short line as its notice', () => {
    const older = text.replace(
      '"generator":"gcportrait",',
      '"generator":"gcportrait","notice":"Not affiliated with Google / Google Cloud.",',
    );
    expect(older).toContain('"notice"');
    const parsed = parseBundle(older);
    expect(parsed.snapshot).toEqual(snapshot);
    expect(parsed.history).toEqual(history);
  });

  it('round-trips the snapshot and its history', () => {
    const parsed = parseBundle(text);
    expect(parsed.snapshot).toEqual(snapshot);
    expect(parsed.history).toEqual(history);
  });

  it('round-trips a snapshot without a history', async () => {
    const parsed = parseBundle(await bundleText(false));
    expect(parsed.snapshot).toEqual(snapshot);
    expect(parsed).not.toHaveProperty('history');
  });

  it('is recognised by its name or its first bytes', () => {
    expect(isBundle('anything.gcportrait.json', '')).toBe(true);
    expect(isBundle('copy.json', text.slice(0, 200))).toBe(true);
    expect(isBundle('copy.json', `\uFEFF  {\n  "format": "${BUNDLE_FORMAT}"`)).toBe(true);
    expect(isBundle('export.json', '{"name":"//compute.googleapis.com/projects/demo-web-1"}')).toBe(false);
  });

  it('is named like the diagram exports', () => {
    expect(bundleFileName('example.com', '2026-10-08T00:00:00Z')).toBe(
      'gcportrait_example.com_20261008T000000Z.gcportrait.json',
    );
  });

  it.each([
    ['not JSON', '{"format":"gcportrait.snapshot",', 'The file is not valid JSON.'],
    [
      'another format',
      '{"format":"something-else","version":1}',
      'The file is not a gcportrait snapshot file.',
    ],
    ['an array', '[]', 'The file is not a gcportrait snapshot file.'],
    ['no version', '{"format":"gcportrait.snapshot"}', 'The snapshot file has no valid version.'],
  ])('refuses %s', (_, input, message) => {
    expect(() => parseBundle(input)).toThrow(new SnapshotFileError(message));
  });

  it('refuses a newer version and asks for an update', () => {
    expect(() => parseBundle(rewrite((bundle) => (bundle['version'] = 2)))).toThrow(/Update gcportrait/);
  });

  it('refuses an invalid snapshot through the model', () => {
    expect(() => parseBundle(rewrite((bundle) => (bundle['snapshot'] = { schemaVersion: 1 })))).toThrow(
      SnapshotFormatError,
    );
  });

  it("refuses a history that does not end with the bundle's snapshot", async () => {
    // Demo S's history with demo M's snapshot.
    const medium = await demoSnapshot(demoHistory('M'));
    expect(() => parseBundle(rewrite((bundle) => (bundle['snapshot'] = medium)))).toThrow(
      new SnapshotFileError(
        `The history does not belong to the snapshot: its last day holds ${String(snapshot.assets.length)} ` +
          `assets, the snapshot ${String(medium.assets.length)}.`,
      ),
    );
    const [first, ...rest] = snapshot.assets;
    if (first === undefined) throw new Error('demo S has assets');
    const other = { ...snapshot, assets: [...rest, { ...first, name: `${first.name}-other` }] };
    expect(() => parseBundle(rewrite((bundle) => (bundle['snapshot'] = other)))).toThrow(
      /, not the same ones\.$/,
    );
    expect(parseHistoryOf(JSON.parse(JSON.stringify(history)), snapshot)).toEqual(history);
  });
});

describe('parseHistory', () => {
  it('accepts a demo history as it is', () => {
    expect(parseHistory(JSON.parse(JSON.stringify(history)))).toEqual(history);
  });

  it.each([
    ['not an object', null, 'The history is not an object.'],
    ['without a size', { ...history, size: 'XXL' }, 'The history has no valid size, seed or day.'],
    ['without ticks', { ...history, ticks: [] }, 'The history has no base or no ticks.'],
    [
      'ending on another day',
      { ...history, today: '2026-10-09' },
      'The history does not end on its own day.',
    ],
    // A timeline tick may be an extra tick's read time; a history's days are days only.
    [
      'whose day is a time',
      { ...history, today: '2026-10-08T00:00:00Z' },
      'The history has no valid size, seed or day.',
    ],
    [
      'with a tick that is a time',
      {
        ...history,
        ticks: history.ticks.map((tick, index) =>
          index === 0 ? { ...tick, tick: `${tick.tick}T00:00:00Z` } : tick,
        ),
      },
      "The history's tick 1 is invalid.",
    ],
  ])('refuses one %s', (_, value, message) => {
    expect(() => parseHistory(value)).toThrow(new SnapshotFileError(message));
  });

  it('refuses an invalid asset and an invalid change', () => {
    expect(() => parseHistory({ ...history, base: [{ name: 'x' }] })).toThrow(
      /invalid asset \(base, asset 1\)/,
    );
    const ticks = history.ticks.map((tick, index) =>
      index === 1 ? { ...tick, mutations: [{ kind: 'rename' }] } : tick,
    );
    expect(() => parseHistory({ ...history, ticks })).toThrow(/invalid change/);
  });

  it('refuses a history that does not replay', () => {
    const first = history.base[0];
    if (first === undefined) throw new Error('demo S has assets');
    const ticks = history.ticks.map((tick, index) =>
      index === 1 ? { ...tick, mutations: [{ kind: 'add', asset: first }] } : tick,
    );
    expect(() => parseHistory({ ...history, ticks })).toThrow(/does not replay/);
  });
});
