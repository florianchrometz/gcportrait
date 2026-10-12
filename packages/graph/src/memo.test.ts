// SPDX-License-Identifier: MIT
/**
 * The builder's memo: an asset object built before with the same catalog and project index is not evaluated
 * again (its node is the very object built before), a changed asset is, and another catalog object or another
 * project index starts the memo empty. That a memo changes no result is a property (build.property.test.ts).
 */
import type { Asset } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { buildGraph } from './build.js';
import { BuildMemo } from './memo.js';
import {
  REAL_CATALOG,
  catalogWith,
  computeName,
  organization,
  project,
  resource,
} from './testing/fixtures.js';

const NUMBER = '10000000001';
const PROJECT_ID = 'demo-memo';
const INSTANCE_TYPE = 'compute.googleapis.com/Instance';

function instance(name: string, title: string): Asset {
  return resource(computeName(PROJECT_ID, `zones/europe-west3-a/instances/${name}`), INSTANCE_TYPE, NUMBER, {
    name,
    description: title,
  });
}

describe('BuildMemo', () => {
  const org = organization();
  const owner = project(NUMBER, PROJECT_ID);
  const kept = instance('kept', 'the same object on both days');
  const changed = instance('changed', 'before');
  const changedNext = instance('changed', 'after');
  const id = (asset: Asset): string => asset.name;

  it('reuses what it worked out for an asset object it built before, and only for that object', () => {
    const memo = new BuildMemo();
    const before = buildGraph({ assets: [org, owner, kept, changed] }, REAL_CATALOG, { memo });
    const after = buildGraph({ assets: [org, owner, kept, changedNext] }, REAL_CATALOG, { memo });
    expect(after.nodes[id(kept)]).toBe(before.nodes[id(kept)]);
    expect(after.nodes[id(changed)]).not.toBe(before.nodes[id(changed)]);
    expect(after).toEqual(buildGraph({ assets: [org, owner, kept, changedNext] }, REAL_CATALOG));
  });

  it('starts empty for another catalog object or another project index', () => {
    const memo = new BuildMemo();
    const first = buildGraph({ assets: [org, owner, kept] }, REAL_CATALOG, { memo });
    const otherCatalog = catalogWith([]);
    const second = buildGraph({ assets: [org, owner, kept] }, otherCatalog, { memo });
    expect(second.nodes[id(kept)]).not.toBe(first.nodes[id(kept)]);
    expect(second).toEqual(first);
    // The project is now known by another id: the instance's node says so, as a build without a memo does.
    const renamed = project(NUMBER, 'demo-memo-renamed');
    const third = buildGraph({ assets: [org, renamed, kept] }, otherCatalog, { memo });
    expect(third.nodes[id(kept)]?.projectId).toBe('demo-memo-renamed');
    expect(third).toEqual(buildGraph({ assets: [org, renamed, kept] }, otherCatalog));
  });
});
