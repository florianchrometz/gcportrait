// SPDX-License-Identifier: MIT
/** Synthetic assets for the unit tests (not part of the public API). */
import type { Asset, ProjectIndex } from '@gcportrait/model';

/** demo-net-1 ↔ 10000000001, demo-app-1 ↔ 10000000002, demo-data-1 ↔ 10000000003. */
export const PROJECTS: ProjectIndex = {
  numberById: { 'demo-net-1': '10000000001', 'demo-app-1': '10000000002', 'demo-data-1': '10000000003' },
  idByNumber: { '10000000001': 'demo-net-1', '10000000002': 'demo-app-1', '10000000003': 'demo-data-1' },
};

const ANCESTORS: Record<string, string[]> = {
  'demo-net-1': ['projects/10000000001', 'folders/20000000001', 'organizations/30000000001'],
  'demo-app-1': ['projects/10000000002', 'folders/20000000001', 'organizations/30000000001'],
  'demo-data-1': ['projects/10000000003', 'folders/20000000001', 'organizations/30000000001'],
};

/** An asset in one of the three demo projects (demo-app-1 unless the name says otherwise). */
export function asset(name: string, assetType: string, data: unknown, extra: Partial<Asset> = {}): Asset {
  const project = /\/projects\/(demo-[a-z]+-1)\//.exec(name)?.[1] ?? 'demo-app-1';
  const number = PROJECTS.numberById[project] ?? '10000000002';
  return {
    name,
    assetType,
    parent: `//cloudresourcemanager.googleapis.com/projects/${number}`,
    ancestors: ANCESTORS[project] ?? [],
    location: 'europe-west3',
    updateTime: '2026-10-01T08:00:00Z',
    data,
    ...extra,
  };
}

/** A Cloud Run service in demo-app-1, a convenient subject for normaliser tests. */
export const RUN_SERVICE = asset(
  '//run.googleapis.com/projects/demo-app-1/locations/europe-west3/services/shop',
  'run.googleapis.com/Service',
  { name: 'projects/demo-app-1/locations/europe-west3/services/shop' },
);

/**
 * A raw CAI asset as a fixture file holds it, before AssetSchema reads it: in demo-net-1 (10000000001), with
 * `overrides` replacing or adding top-level fields (the way tests plant an invalid one).
 */
export function rawAsset(
  name: string,
  assetType: string,
  data: unknown,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    assetType,
    parent: '//cloudresourcemanager.googleapis.com/projects/10000000001',
    ancestors: ['projects/10000000001', 'organizations/30000000001'],
    location: 'europe-west3',
    updateTime: '2026-10-01T08:00:00Z',
    data,
    ...overrides,
  };
}
