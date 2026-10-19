// SPDX-License-Identifier: Apache-2.0
import { catalog } from '@gcportrait/catalog';
import { describe, expect, it } from 'vitest';

import { ROLES, coverageReport, parseCoverageJson, percent, products, totals } from './coverage.js';
import {
  filterProductCatalog,
  formatSearchStatus,
  matchesTokens,
  tokenizeQuery,
  type SearchableProduct,
} from './coverage-search.js';

describe('the coverage page’s data', () => {
  it('counts the compiled catalog: types by role and console links add up', () => {
    const numbers = totals();
    expect(numbers.mapped).toBe(Object.keys(catalog.types).length);
    expect(ROLES.reduce((sum, role) => sum + numbers.byRole[role], 0)).toBe(numbers.mapped);
    expect(ROLES.reduce((sum, role) => sum + numbers.withConsoleByRole[role], 0)).toBe(numbers.withConsole);
    expect(numbers.lenses).toBe(Object.keys(catalog.lenses).length);
    expect(products().reduce((sum, product) => sum + product.types.length, 0)).toBe(numbers.mapped);
    expect(percent(632, 641)).toBe('98.6');
  });

  it('reads the coverage `pnpm catalog:build` writes, whose groups account for the official list', () => {
    const report = coverageReport();
    expect(report.officialTotal).toBeGreaterThan(600);
    expect(report.officialDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const owned = report.groups.reduce((sum, group) => sum + group.official, 0);
    expect(owned).toBe(report.officialTotal);
    for (const group of report.groups) for (const item of group.unmapped) expect(item.reason).not.toBe('');
  });

  it('refuses coverage data of another shape', () => {
    expect(() => parseCoverageJson('{"groups": []}')).toThrow(/pnpm catalog:build/);
    const minimal = parseCoverageJson(
      JSON.stringify({ officialDate: '2026-10-09', officialTotal: 2, groups: [] }),
    );
    expect(minimal).toEqual({ officialDate: '2026-10-09', officialTotal: 2, groups: [] });
  });

  it('filters products and asset types by service name, API host or asset type', () => {
    const sample: readonly SearchableProduct[] = [
      {
        product: 'Cloud Run',
        service: 'run.googleapis.com',
        types: [
          { type: 'run.googleapis.com/Job', role: 'core' },
          { type: 'run.googleapis.com/Service', role: 'core' },
        ],
      },
      {
        product: 'Compute Engine',
        service: 'compute.googleapis.com',
        types: [
          { type: 'compute.googleapis.com/Instance', role: 'core' },
          { type: 'compute.googleapis.com/Subnetwork', role: 'container' },
        ],
      },
    ];

    expect(tokenizeQuery('  Cloud   Run  ')).toEqual(['cloud', 'run']);
    expect(matchesTokens('cloud run run.googleapis.com', ['cloud', 'run'])).toBe(true);
    expect(matchesTokens('cloud run run.googleapis.com', ['compute'])).toBe(false);

    const idle = filterProductCatalog(sample, '   ');
    expect(idle.active).toBe(false);
    expect(idle.matchedProducts).toBe(2);
    expect(idle.matchedTypes).toBe(4);
    expect(formatSearchStatus(idle)).toBe(
      '2 products. Open one to see its types, their roles, and whether the type has its own Cloud Console link.',
    );

    // Matching by API host opens the product and keeps all of its types visible.
    const byApi = filterProductCatalog(sample, 'run.googleapis.com');
    expect(byApi.active).toBe(true);
    expect(byApi.matchedProducts).toBe(1);
    expect(byApi.matchedTypes).toBe(2);
    expect(byApi.products).toEqual([
      { visible: true, open: true, visibleTypes: [true, true] },
      { visible: false, open: false, visibleTypes: [false, false] },
    ]);
    expect(formatSearchStatus(byApi)).toBe('1 of 2 products (2 types) matching “run.googleapis.com”.');

    // Matching a specific asset type or role opens the product and narrows to matching types.
    const byType = filterProductCatalog(sample, 'Subnetwork');
    expect(byType.matchedProducts).toBe(1);
    expect(byType.matchedTypes).toBe(1);
    expect(byType.products).toEqual([
      { visible: false, open: false, visibleTypes: [false, false] },
      { visible: true, open: true, visibleTypes: [false, true] },
    ]);
    expect(formatSearchStatus(byType)).toBe('1 of 2 products (1 type) matching “Subnetwork”.');

    const none = filterProductCatalog(sample, 'nonexistent.googleapis.com');
    expect(none.matchedProducts).toBe(0);
    expect(none.matchedTypes).toBe(0);
    expect(formatSearchStatus(none)).toBe('No products or asset types match “nonexistent.googleapis.com”.');
  });
});
