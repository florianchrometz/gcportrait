// SPDX-License-Identifier: Apache-2.0
/** A demo organisation as a `Snapshot` of `@gcportrait/model`, and the per-type statistics. */
import { SNAPSHOT_SCHEMA_VERSION, type Asset, type Snapshot } from '@gcportrait/model';
import { hash32 } from '../core/hash.js';
import { ulid } from '../core/ids.js';
import { Rng } from '../core/rng.js';
import type { DemoOrganization } from '../history/types.js';
import { DEMO_ORGANIZATION_IDS } from '../constants.js';
import { ORGANIZATION_DOMAIN } from '../topology/kit.js';
import { toCaiNdjson, utf8Length } from './cai.js';

export interface AssetStats {
  readonly count: number;
  /** Asset type → count, keys sorted. */
  readonly byType: Readonly<Record<string, number>>;
}

export function computeStats(assets: readonly Pick<Asset, 'assetType'>[]): AssetStats {
  const counts = new Map<string, number>();
  for (const asset of assets) counts.set(asset.assetType, (counts.get(asset.assetType) ?? 0) + 1);
  const byType: Record<string, number> = {};
  for (const type of [...counts.keys()].sort()) byType[type] = counts.get(type) ?? 0;
  return { count: assets.length, byType };
}

/**
 * The organisation as a Snapshot (scope: the demo organisation; source: `demo`). The id is a ULID of the read
 * time with random bits drawn from the size, seed and tick, so it is stable. `stats.bytes` is the size of the
 * equivalent CAI NDJSON.
 */
export function toSnapshot(org: DemoOrganization): Snapshot {
  const readTime = Date.parse(org.readTime);
  const stats = computeStats(org.assets);
  return {
    id: ulid(readTime, new Rng(hash32(`snapshot:${org.size}:${org.tick}`, org.seed))),
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    scope: { kind: 'organization', id: DEMO_ORGANIZATION_IDS[org.size], displayName: ORGANIZATION_DOMAIN },
    readTime: org.readTime,
    source: { kind: 'demo', detail: `demo:${org.size} seed ${String(org.seed)}` },
    contentType: 'RESOURCE',
    assets: [...org.assets],
    stats: { count: stats.count, byType: { ...stats.byType }, bytes: utf8Length(toCaiNdjson(org.assets)) },
  };
}
