// SPDX-License-Identifier: Apache-2.0
/**
 * Counting subtitles go through `plural(…)`: a template that writes a value straight before a
 * plural noun ("{{data.shardCount}} shards") reads "1 shards" for a single one. A range ("{{min}}–{{max}}
 * replicas") is plural whatever its ends, and a unit in capitals ("{{data.sizeGb}} GB") is no noun.
 */
import { describe, expect, it } from 'vitest';
import { catalog } from '../src/index.js';

/** A placeholder not ending a range, straight before a lower-case word ending in s. */
const BARE_COUNT = /(?<!–)\{\{[^}]*\}\}\s+[a-z]+s\b/g;

describe('counting templates', () => {
  it('put every count before a plural noun through plural(…), in every label and subtitle', () => {
    const offenders: string[] = [];
    for (const [assetType, type] of Object.entries(catalog.types)) {
      for (const [field, template] of [
        ['label', type.label],
        ['subtitle', type.subtitle],
      ] as const) {
        for (const match of template?.matchAll(BARE_COUNT) ?? [])
          offenders.push(`${assetType} ${field}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('finds the pattern it guards against, and leaves ranges and units alone', () => {
    const matches = (text: string): string[] => [...text.matchAll(BARE_COUNT)].map((match) => match[0]);
    expect(matches('{{data.shardCount}} shards · {{data.sizeGb}} GB')).toEqual([
      '{{data.shardCount}} shards',
    ]);
    expect(matches('{{data.spec.minReplicas}}–{{data.spec.maxReplicas}} replicas')).toEqual([]);
    expect(matches('{{data.shardCount | plural(shard)}} · {{data.sizeGb}} GB')).toEqual([]);
  });
});
