// SPDX-License-Identifier: MIT
/**
 * The catalog fixture: `catalogWith` validates only the entries a test adds and takes the base as valid, so
 * these tests hold what it builds to `CatalogSchema` (a catalog the schema returns unchanged, key order
 * included, is the one a parse of the whole catalog would return), check that the additions are validated, and
 * that no test can change the catalog of the next.
 */
import { CatalogSchema, type Catalog } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { REAL_CATALOG, catalogWith, type CatalogEntryInput } from './fixtures.js';
import { SCENARIO_ENTRIES, scenarioCatalog } from './scenario.js';
import { viewCatalog } from './views.js';

const NETWORK = 'compute.googleapis.com/Network';
const INSTANCE = 'compute.googleapis.com/Instance';

const COMPUTE_NETWORK: CatalogEntryInput = {
  product: 'Compute Engine',
  service: 'compute.googleapis.com',
  icon: 'compute_engine',
  types: { [NETWORK]: { role: 'leaf' } },
};

const BOXES: CatalogEntryInput = {
  product: 'Boxes',
  service: 'boxes.googleapis.com',
  icon: 'boxes',
  types: {
    'boxes.googleapis.com/Box': {
      role: 'container',
      contains: [{ byParent: 'compute.googleapis.com/Disk' }],
      zoneKind: 'group',
    },
    'compute.googleapis.com/Disk': { role: 'leaf' },
  },
};

describe('catalogWith', () => {
  const cases: ReadonlyArray<readonly [string, () => Catalog]> = [
    ['no entries', () => catalogWith([])],
    ['the scenario entries', scenarioCatalog],
    ['the views entries, some on products the compiled catalog has', viewCatalog],
    [
      'the scenario entries, only where the compiled catalog lacks a type',
      () => catalogWith(SCENARIO_ENTRIES, 'fill'),
    ],
    [
      'a new product taking a type over, on another catalog as base',
      () => catalogWith([BOXES], 'override', viewCatalog()),
    ],
  ];

  it.each(cases)('%s: builds a catalog that CatalogSchema returns as it is', (_, build) => {
    const catalog = build();
    const parsed = CatalogSchema.parse(catalog);
    expect(parsed).toStrictEqual(catalog);
    expect(JSON.stringify(parsed, null, 1), 'the same keys in the same order').toBe(
      JSON.stringify(catalog, null, 1),
    );
  });

  it('replaces a compiled type in override mode and keeps it in fill mode', () => {
    expect(catalogWith([COMPUTE_NETWORK]).types[NETWORK]?.role).toBe('leaf');
    expect(catalogWith([COMPUTE_NETWORK], 'fill').types[NETWORK]).toStrictEqual(REAL_CATALOG.types[NETWORK]);
    const moved = catalogWith([BOXES]);
    expect(moved.products.find((product) => product.product === 'Boxes')?.types).toEqual([
      'boxes.googleapis.com/Box',
      'compute.googleapis.com/Disk',
    ]);
    expect(
      moved.products.filter((product) => product.types.includes('compute.googleapis.com/Disk')),
    ).toHaveLength(1);
  });

  it('validates every entry and type it adds', () => {
    const label = { ...COMPUTE_NETWORK, types: { [NETWORK]: { role: 'leaf' as const, label: '{{nope}}' } } };
    expect(() => catalogWith([label])).toThrow(/must be text with/);
    const contains = {
      ...COMPUTE_NETWORK,
      types: { [NETWORK]: { role: 'core' as const, contains: ['$.data.x'] } },
    };
    expect(() => catalogWith([contains])).toThrow(/only container types have contains rules/);
    expect(() => catalogWith([{ ...COMPUTE_NETWORK, icon: '' }])).toThrow();
  });

  it('builds the catalog, its products and its records anew on every call', () => {
    const changed = catalogWith([]);
    expect(changed).not.toBe(catalogWith([]));
    changed.products.pop();
    changed.products[0]?.types.push('example.googleapis.com/Planted');
    changed.types['example.googleapis.com/Planted'] = changed.types[NETWORK] ?? expect.unreachable();
    changed.lenses.overview = changed.lenses.networking;
    changed.version = '9.9.9';
    expect(catalogWith([])).toStrictEqual(REAL_CATALOG);
    expect(REAL_CATALOG.types['example.googleapis.com/Planted']).toBeUndefined();
  });

  it('freezes the types and lenses, shares the base ones, and leaves the compiled catalog as it is', () => {
    const catalog = catalogWith(SCENARIO_ENTRIES);
    const network = catalog.types[NETWORK] ?? expect.unreachable();
    const instance = catalog.types[INSTANCE] ?? expect.unreachable();
    expect(Object.isFrozen(network)).toBe(true);
    expect(Object.isFrozen(network.relations)).toBe(true);
    expect(Object.isFrozen(instance.relations[0])).toBe(true);
    expect(Object.isFrozen(catalog.lenses.overview.types)).toBe(true);
    expect(() => {
      network.relations.push({ kind: 'uses', to: '$.data.x', normalize: 'name' });
    }).toThrow(TypeError);
    expect(catalogWith([]).types[NETWORK], 'one frozen copy of the base').toBe(network);
    expect(Object.isFrozen(REAL_CATALOG.types[NETWORK])).toBe(false);
    expect(network).toStrictEqual(REAL_CATALOG.types[NETWORK]);
  });
});
