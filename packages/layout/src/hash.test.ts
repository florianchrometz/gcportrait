// SPDX-License-Identifier: Apache-2.0
/**
 * The memo key (hash.ts): deterministic (pinned values), independent of object key order (in every object of
 * a Scene, and over random JSON with shuffled keys), sensitive to everything else (array order, every field,
 * types, string boundaries), and without a key for values that are not plain-data trees.
 */
import fc from 'fast-check';
import type { Scene } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { MAX_KEY_DEPTH, layoutKey, structuralHash } from './hash.js';
import { arbitraryScene, card, scene, zone } from './testing/scenes.js';

/** A deep copy whose objects list their keys in reverse order (arrays keep theirs). */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).reverse())
    out[key] = reverseKeys((value as Record<string, unknown>)[key]);
  return out;
}

/** A deep copy whose objects list their keys in an order driven by `seed` (no Math.random). */
function shuffleKeys(value: unknown, seed: number): unknown {
  if (Array.isArray(value)) return value.map((item, i) => shuffleKeys(item, seed * 31 + i));
  if (typeof value !== 'object' || value === null) return value;
  const keys = Object.keys(value);
  let state = seed >>> 0;
  for (let i = keys.length - 1; i > 0; i -= 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const j = state % (i + 1);
    [keys[i], keys[j]] = [keys[j] as string, keys[i] as string];
  }
  const out: Record<string, unknown> = {};
  for (const key of keys) out[key] = shuffleKeys((value as Record<string, unknown>)[key], seed + key.length);
  return out;
}

/** JSON with every object's keys sorted: equal exactly when two JSON values are equal as data. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value !== 'object' || value === null) return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

const SAMPLE = scene(
  [
    zone('folder-a', 'folder', [
      zone('project-a', 'project', [card('vm-1', 'web-1', '10.0.0.2'), card('vm-2')], {
        badges: ['shared with 3 projects'],
      }),
      zone('project-b', 'project', [], { collapsed: { networks: 2, resources: 39 } }),
    ]),
  ],
  [
    { from: 'vm-1', to: 'vm-2', kind: 'uses' },
    { from: 'project-a', to: 'project-b', kind: 'shares', count: 3 },
  ],
);

describe('structuralHash', () => {
  it('is pinned: the same value always hashes to the same key, on every platform', () => {
    // Pinned values: a change of the algorithm must be deliberate (it only invalidates in-memory memos).
    expect(structuralHash({})).toMatchInlineSnapshot(`"a219b7e0f6502795-3"`);
    expect(structuralHash('')).toMatchInlineSnapshot(`"2a3e91fa7dc2a555-3"`);
    expect(structuralHash([1, 'a', null, true, { b: [] }])).toMatchInlineSnapshot(`"dbe970b6011c6015-n"`);
    expect(layoutKey(SAMPLE)).toMatchInlineSnapshot(`"00a926e728e42aba-mx"`);
  });

  it('does not depend on the order of object keys', () => {
    expect(structuralHash({ a: 1, b: 2 })).toBe(structuralHash({ b: 2, a: 1 }));
    expect(layoutKey(reverseKeys(SAMPLE) as Scene)).toBe(layoutKey(SAMPLE));
    expect(layoutKey(SAMPLE, { targetAspect: 1.5, sizing: { cardHeight: 40, gapVertical: 10 } })).toBe(
      layoutKey(reverseKeys(SAMPLE) as Scene, {
        sizing: { gapVertical: 10, cardHeight: 40 },
        targetAspect: 1.5,
      }),
    );
  });

  it('does not depend on key order for random JSON values and random Scenes (property)', () => {
    fc.assert(
      fc.property(fc.jsonValue(), fc.nat(), (value, seed) => {
        expect(structuralHash(shuffleKeys(value, seed))).toBe(structuralHash(value));
      }),
      { numRuns: 300, seed: 31415 },
    );
    fc.assert(
      fc.property(arbitraryScene({ maxNodes: 60, maxEdges: 30 }), fc.nat(), (value, seed) => {
        expect(layoutKey(shuffleKeys(value, seed) as Scene)).toBe(layoutKey(value));
      }),
      { numRuns: 60, seed: 27182 },
    );
  });

  it('gives different values different keys (property: no collision among 3 000 distinct JSON values)', () => {
    const byCanonical = new Map<string, string>();
    const byHash = new Map<string, string>();
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const text = canonical(value);
        const hash = structuralHash(value) as string;
        const known = byCanonical.get(text);
        if (known !== undefined) {
          expect(hash).toBe(known);
          return;
        }
        byCanonical.set(text, hash);
        const other = byHash.get(hash);
        expect(other === undefined ? undefined : `${other} collides with ${text}`).toBeUndefined();
        byHash.set(hash, text);
      }),
      { numRuns: 3000, seed: 16180 },
    );
    expect(byHash.size).toBeGreaterThan(2000);
  });

  it('tells apart values that a naive concatenation would confuse', () => {
    const distinct: unknown[] = [
      ['ab', 'c'],
      ['a', 'bc'],
      'abc',
      ['abc'],
      { a: 'bc' },
      { ab: 'c' },
      1,
      '1',
      [1],
      true,
      'true',
      null,
      'null',
      [],
      {},
      [[]],
      [{}],
      0.1,
      1e21,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      10n,
      '10',
      [undefined],
      [null],
      { a: null },
    ];
    const hashes = distinct.map((value) => structuralHash(value));
    expect(new Set(hashes).size).toBe(distinct.length);
  });

  it('sorts the keys of large objects too (pinned arrangements keyed by zone id)', () => {
    const zones = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        `zone-${String((i * 17) % 40)}`,
        { cardColumns: i, zoneRows: [] },
      ]),
    );
    const reversed = Object.fromEntries(Object.entries(zones).reverse());
    expect(structuralHash({ zones })).toBe(structuralHash({ zones: reversed }));
    expect(structuralHash({ zones })).not.toBe(
      structuralHash({ zones: { ...zones, 'zone-0': { cardColumns: 1, zoneRows: [] } } }),
    );
  });

  it('treats a key whose value is undefined as absent, and -0 as 0 (as JSON does)', () => {
    expect(structuralHash({ a: 1, b: undefined })).toBe(structuralHash({ a: 1 }));
    expect(structuralHash(-0)).toBe(structuralHash(0));
    // In an array, undefined is a value of its own (JSON would write null there).
    expect(structuralHash([undefined])).not.toBe(structuralHash([]));
    expect(structuralHash(undefined)).not.toBe(structuralHash(null));
  });

  it('hashes a subtree reached twice (without a cycle) like two copies of it', () => {
    const shared = { kind: 'uses', from: 'a' };
    expect(structuralHash({ x: shared, y: shared })).toBe(
      structuralHash({ x: { ...shared }, y: { from: 'a', kind: 'uses' } }),
    );
  });

  it('has no key for values that are not plain-data trees', () => {
    expect(structuralHash(() => 1)).toBeNull();
    expect(structuralHash({ a: Symbol('s') })).toBeNull();
    const cyclic = zone('loop', 'folder', []);
    cyclic.children.push(cyclic);
    expect(layoutKey({ ...SAMPLE, children: [cyclic] })).toBeNull();
    const list: unknown[] = [];
    list.push(list);
    expect(structuralHash(list)).toBeNull();
    let deep: unknown = 'leaf';
    for (let i = 0; i < MAX_KEY_DEPTH + 1; i += 1) deep = [deep];
    expect(structuralHash(deep)).toBeNull();
    let shallow: unknown = 'leaf';
    for (let i = 0; i < MAX_KEY_DEPTH; i += 1) shallow = [shallow];
    expect(structuralHash(shallow)).not.toBeNull();
    // A subtree shared over and over: 2^40 leaves as data, far past the walk's limit.
    let bomb: unknown = 'x'.repeat(4096);
    for (let i = 0; i < 40; i += 1) bomb = [bomb, bomb];
    expect(structuralHash(bomb)).toBeNull();
  });

  it('rethrows what is not a hashing problem (a throwing getter)', () => {
    const hostile = {
      get boom(): never {
        throw new Error('getter');
      },
    };
    expect(() => structuralHash(hostile)).toThrow('getter');
  });
});

describe('layoutKey', () => {
  it('is the same for absent and empty options, and differs for every change', () => {
    const base = layoutKey(SAMPLE);
    expect(layoutKey(SAMPLE, {})).toBe(base);
    const variants: (string | null)[] = [
      layoutKey(SAMPLE, { route: false }),
      layoutKey(SAMPLE, { targetAspect: 1.6 }),
      layoutKey({ ...SAMPLE, edges: [...SAMPLE.edges].reverse() }),
      layoutKey(scene([zone('folder-a', 'folder', [])])),
      layoutKey(scene([card('vm-1', 'web-1', '10.0.0.3')])),
      layoutKey(scene([card('vm-1', 'web-1', '10.0.0.2')])),
    ];
    expect(new Set([base, ...variants]).size).toBe(variants.length + 1);
    expect(variants).not.toContain(null);
  });

  it('leaves the Scene’s metadata out: a timeline day that differs only in its read time shares the key', () => {
    const base = layoutKey(SAMPLE);
    expect(layoutKey({ ...SAMPLE, metadata: { ...SAMPLE.metadata, readTime: '2026-09-17T00:00:00Z' } })).toBe(
      base,
    );
    expect(
      layoutKey({
        ...SAMPLE,
        metadata: {
          rootLabel: 'demo-web-1',
          lens: 'networking',
          readTime: '2026-10-07T09:12:00Z',
          rectCount: SAMPLE.metadata.rectCount,
          focusError: { code: 'unknown-project', message: 'No project demo-web-9.' },
        },
      }),
    ).toBe(base);
    // The tree still counts.
    expect(layoutKey({ ...SAMPLE, edges: SAMPLE.edges.slice(1) })).not.toBe(base);
  });

  it('has no key when an option is a function (the worker takes its clock from its environment)', () => {
    const options = { clock: () => 0 } as unknown as Parameters<typeof layoutKey>[1];
    expect(layoutKey(SAMPLE, options)).toBeNull();
  });
});
