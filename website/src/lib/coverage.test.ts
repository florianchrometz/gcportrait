// SPDX-License-Identifier: Apache-2.0
import { catalog } from '@gcportrait/catalog';
import { describe, expect, it } from 'vitest';

import { ROLES, coverageReport, parseCoverageJson, percent, products, totals } from './coverage.js';

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
});
