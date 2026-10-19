// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * The drawer's deep diff of `resource.data` (fieldDiff.ts): leaves that differ with their dotted paths,
 * deterministic, capped with a count, short previews; and on demo S and M's histories it finds every field the
 * generator says each change touched.
 */
import { snapshotAt } from '@gcportrait/demo-data';
import { describe, expect, it } from 'vitest';

import { demoHistory } from '../diagram/pipeline/demo';
import { FIELD_CAP, fieldDiff, MAX_FIELD_DEPTH, preview, PREVIEW_LENGTH, ROOT_PATH } from './fieldDiff';

/** The value at a dotted path as the demo generator writes them (`a.b[2]['c.d']`). */
function valueAt(value: unknown, path: string): unknown {
  let current = value;
  for (const match of path.matchAll(/([^.[\]']+)|\[(\d+)\]|\['([^']*)'\]/g)) {
    const key = match[1] ?? match[3] ?? Number(match[2]);
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

describe('the deep diff of resource.data', () => {
  it('finds nothing when the values are alike, whatever the order of their keys', () => {
    expect(fieldDiff({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toEqual({
      entries: [],
      more: 0,
    });
    expect(fieldDiff(undefined, undefined)).toEqual({ entries: [], more: 0 });
  });

  it('lists each leaf that differs with its path: changed, added, removed, in key order', () => {
    const before = { sizeGb: '100', labels: { team: 'web', env: 'prod' }, rules: [{ action: 'allow' }] };
    const after = {
      sizeGb: '200',
      labels: { team: 'web', tier: 'gold' },
      rules: [{ action: 'deny' }, { action: 'allow' }],
    };
    expect(fieldDiff(before, after).entries).toEqual([
      { path: 'labels.env', kind: 'removed', before: '"prod"' },
      { path: 'labels.tier', kind: 'added', after: '"gold"' },
      { path: 'rules[0].action', kind: 'changed', before: '"allow"', after: '"deny"' },
      { path: 'rules[1]', kind: 'added', after: '{"action":"allow"}' },
      { path: 'sizeGb', kind: 'changed', before: '"100"', after: '"200"' },
    ]);
  });

  it('quotes keys that are no identifiers, and names resource.data itself when it is no object', () => {
    expect(
      fieldDiff({ 'a.b': 1, 'kubernetes.io/name': 'x' }, { 'a.b': 2, 'kubernetes.io/name': 'y' }).entries.map(
        (e) => e.path,
      ),
    ).toEqual(['["a.b"]', '["kubernetes.io/name"]']);
    expect(fieldDiff(undefined, { a: 1 }).entries).toEqual([
      { path: ROOT_PATH, kind: 'added', after: '{"a":1}' },
    ]);
    expect(fieldDiff({ a: { b: 1 } }, { a: 'flat' }).entries).toEqual([
      { path: 'a', kind: 'changed', before: '{"b":1}', after: '"flat"' },
    ]);
  });

  it('keeps the first entries and counts the rest', () => {
    const before = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`k${String(index).padStart(2, '0')}`, index]),
    );
    const after = Object.fromEntries(Object.entries(before).map(([key, value]) => [key, value + 1]));
    const summary = fieldDiff(before, after);
    expect(summary.entries).toHaveLength(FIELD_CAP);
    expect(summary.more).toBe(20 - FIELD_CAP);
    expect(summary.entries[0]?.path).toBe('k00');
    expect(fieldDiff(before, after, 3)).toMatchObject({ more: 17 });
  });

  it('cuts long previews with an ellipsis, and compares very deep values as a whole', () => {
    expect(preview('x'.repeat(200))).toHaveLength(PREVIEW_LENGTH);
    expect(preview('x'.repeat(200)).endsWith('…')).toBe(true);
    expect(preview(undefined)).toBe('undefined');
    let deepBefore: unknown = 1;
    let deepAfter: unknown = 2;
    for (let level = 0; level < MAX_FIELD_DEPTH + 4; level += 1) {
      deepBefore = { n: deepBefore };
      deepAfter = { n: deepAfter };
    }
    const [entry] = fieldDiff(deepBefore, deepAfter).entries;
    expect(entry?.kind).toBe('changed');
    expect(entry?.path.split('.')).toHaveLength(MAX_FIELD_DEPTH);
  });

  it.each(['S', 'M'] as const)('finds every field each change of demo %s’s history touched', (size) => {
    const history = demoHistory(size);
    let checked = 0;
    for (let index = 1; index < history.ticks.length; index += 1) {
      const before = new Map(snapshotAt(history, index - 1).assets.map((asset) => [asset.name, asset]));
      for (const mutation of history.ticks[index]?.mutations ?? []) {
        if (mutation.kind !== 'change') continue;
        const old = before.get(mutation.asset.name)?.data;
        const paths = fieldDiff(old, mutation.asset.data, 1000).entries.map((entry) => entry.path);
        for (const field of mutation.fields) {
          // A field the generator names but left as it was (a resize to the size it had) is no difference.
          if (JSON.stringify(valueAt(old, field)) === JSON.stringify(valueAt(mutation.asset.data, field)))
            continue;
          checked += 1;
          // The generator writes a key that is no identifier in single quotes, the summary in JSON's double quotes.
          const wanted = field.replace(/\['([^']*)'\]/g, '["$1"]');
          // The field itself, a leaf under it, or (a value added or removed whole) the object around it.
          const under = (inner: string, outer: string): boolean =>
            inner === outer || inner.startsWith(`${outer}.`) || inner.startsWith(`${outer}[`);
          const covered = paths.some((path) => under(path, wanted) || under(wanted, path));
          expect(covered, `${mutation.asset.name}: ${field} in ${paths.join(', ')}`).toBe(true);
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
});
