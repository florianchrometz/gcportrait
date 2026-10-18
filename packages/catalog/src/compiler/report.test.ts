// SPDX-License-Identifier: Apache-2.0
/**
 * The text form of the coverage report, asserted here once, line by line: the command-line tests check exit
 * codes, JSON and one phrase each, so a change of padding or wording is made in one place.
 */
import { describe, expect, it } from 'vitest';
import {
  NETWORK,
  NET_FILE,
  OFFICIAL,
  ROUTE,
  SELF,
  SUBNETWORK,
  WEB_FILE,
  compile,
  group,
  product,
  scoped,
  shared,
  typeOf,
  world,
} from '../testing/world.js';
import { formatGroupDetails, formatGroups, formatReport, formatTrace, formatViolations } from './report.js';
import type { GroupCoverage, Violation } from './types.js';

const FIREWALL = 'compute.googleapis.com/Firewall';

describe('formatReport', () => {
  it('prints the whole catalog: totals, reasons, counts, icon keys, one line per group, then OK', () => {
    expect(formatReport(compile(world()).report)).toEqual([
      'catalog:check: official list 2026-10-08 (3 types, references/cai-supported-asset-types.2026-10-08.txt)',
      '  mapped:       2 of 3 (66.7 %): container 2, core 0, leaf 0, hidden 0',
      '  unmapped:     1: 1 listed in known-unmapped/, 0 not listed there',
      '                  pending (networking-fabric): 1',
      '  not official: 0 (0 marked deprecated: none)',
      '  catalog:      1 products in 1 files, 2 types, 4 rules, 2 fixture files (0 types without one), 11 lenses, 2 icon keys, 1 groups',
      '  unused icon keys:       none',
      '  pending icon keys:      none',
      '  rules without fixtures: 0',
      '  fixtures without rules: none',
      '  types without a console template: 1 (list in --verbose)',
      '  types no group owns:    0',
      '  groups (official types owned · mapped · unmapped · missing · coverage):',
      '    net    3 official · 2 mapped (2 container) · 1 unmapped · 0 missing · 66.7 %',
      'catalog:check: OK.',
    ]);
  });

  it('counts pending icon keys in the header and names them', () => {
    const w = world();
    typeOf(w, SUBNETWORK)['icon'] = 'subnet';
    expect(formatReport(compile(w).report)).toContain(
      '  pending icon keys:      1 (not in icon-keys.json yet; a warning without --strict-icons): subnet',
    );
  });

  it('prints a scoped report: the scope, only its groups with their reasons, its warnings, notes, OK for it', () => {
    // net's check, while web gives the shared product another icon (blamed on web's file: a note for net).
    const w = shared();
    (w.products[WEB_FILE] as { icon: string }).icon = 'cloud_load_balancing';
    (product(w, NET_FILE).types[SUBNETWORK] as Record<string, unknown>)['icon'] = 'subnet';
    group(w).types = { [FIREWALL]: 'pending (networking-fabric)' };
    const { report } = compile(w, { ...OFFICIAL, types: new Set([...OFFICIAL.types, FIREWALL]) });
    const net = scoped(report, w, 'net');
    const scope = { label: 'group net', files: net.files.length, outside: net.outside, related: net.related };
    expect(formatReport(net.report, { scope })).toEqual([
      'catalog:check: official list 2026-10-08 (4 types, references/cai-supported-asset-types.2026-10-08.txt)',
      '  scope:        group net (4 files); 1 violation(s) elsewhere not shown (run without --group/--file for them)',
      '  groups (official types owned · mapped · unmapped · missing · coverage):',
      '    net    3 official · 2 mapped (2 container) · 1 unmapped · 0 missing · 66.7 %',
      '        unmapped, pending (networking-fabric): 1',
      'catalog:check: 1 warning(s):',
      `  [unknown-icon] ${NET_FILE}: icon key subnet is not in icon-keys.json yet (pending: a warning without --strict-icons)`,
      'catalog:check: 1 note(s): problems blamed on files outside the selection that name one of yours (each is blamed on the file that has to change, so they do not fail this check):',
      `  [product-mismatch] ${WEB_FILE}: Compute Engine (compute.googleapis.com) has icon compute_engine in ${NET_FILE}, the first file of the product, and cloud_load_balancing here: use compute_engine (override single types with their own icon)`,
      'catalog:check: OK for group net.',
    ]);
    expect(formatReport(net.report, { scope: { label: 'file x.yaml', files: 1, outside: 2 } })[1]).toBe(
      '  scope:        file x.yaml (1 file); 2 violation(s) elsewhere not shown (run without --group/--file for them)',
    );
  });

  it('counts the types without a console template, and lists them with --verbose', () => {
    const { report } = compile(world());
    const missing = report.typesWithoutConsole;
    expect(missing).toEqual([...missing].sort());
    const text = formatReport(report).join('\n');
    expect(text).toContain(
      `  types without a console template: ${String(missing.length)} (list in --verbose)`,
    );
    const withList = { ...report, typesWithoutConsole: ['a.googleapis.com/B', 'c.googleapis.com/D'] };
    expect(formatReport(withList).join('\n')).not.toContain('  a.googleapis.com/B');
    const verbose = formatReport(withList, { verbose: true });
    expect(verbose).toContain(
      "catalog:check: 2 type(s) without a console template (the app offers the project's console home instead):",
    );
    expect(verbose).toContain('  a.googleapis.com/B');
    expect(verbose).toContain('  c.googleapis.com/D');
  });

  it('lists violations by code with their location, capped per code', () => {
    const violations: Violation[] = [
      { code: 'unmapped', message: 'one', file: 'known-unmapped/net.yaml' },
      { code: 'syntax', message: 'two', file: 'products/x.yaml', line: 7 },
      { code: 'lens-missing', message: 'three' },
      ...Array.from({ length: 45 }, (_, i): Violation => ({
        code: 'unmapped',
        message: `more ${String(i)}`,
      })),
    ];
    const lines = formatViolations(violations);
    expect(lines[0]).toBe('  [unmapped] known-unmapped/net.yaml: one');
    expect(lines).toContain('  [syntax] products/x.yaml:7: two');
    expect(lines).toContain('  [lens-missing] three');
    expect(lines).toContain('  [unmapped] … and 6 more (--json lists every one)');
    expect(lines).toHaveLength(43);
  });

  it('ends with the number of violations instead of OK', () => {
    const violations: Violation[] = [{ code: 'unmapped', message: 'one' }];
    expect(formatReport({ ...compile(world()).report, violations }).slice(-2)).toEqual([
      'catalog:check: 1 violation(s):',
      '  [unmapped] one',
    ]);
  });
});

describe('formatGroups and formatGroupDetails', () => {
  function coverage(
    name: string,
    official: number,
    mapped: Partial<GroupCoverage['mapped']>,
    byReason: Record<string, number>,
    missing: string[],
    coveragePercent: number,
  ): GroupCoverage {
    const roles = { container: 0, core: 0, leaf: 0, hidden: 0, ...mapped };
    return {
      group: name,
      title: name,
      file: `known-unmapped/${name}.yaml`,
      official,
      mapped: { ...roles, total: roles.container + roles.core + roles.leaf + roles.hidden },
      unmapped: { total: Object.values(byReason).reduce((sum, n) => sum + n, 0), byReason, types: {} },
      missing,
      coveragePercent,
      productFiles: [],
      fixtureFiles: [],
    };
  }

  it('pads the group names to one column and lists unmapped reasons and missing types under each', () => {
    expect(
      formatGroupDetails([
        coverage('dns', 2, { core: 1 }, { 'pending (dns-domains)': 1 }, [], 50),
        coverage('networking-fabric', 112, { container: 2, leaf: 1, hidden: 3 }, {}, [ROUTE, FIREWALL], 5.4),
      ]),
    ).toEqual([
      '    dns                  2 official · 1 mapped (1 core) · 1 unmapped · 0 missing · 50.0 %',
      '        unmapped, pending (dns-domains): 1',
      '    networking-fabric  112 official · 6 mapped (2 container, 1 leaf, 3 hidden) · 0 unmapped · 2 missing · 5.4 %',
      `        missing: ${ROUTE}, ${FIREWALL}`,
    ]);
  });

  it('prints nothing for no groups', () => {
    expect(formatGroups([])).toEqual([]);
  });
});

describe('formatTrace (--verbose)', () => {
  it('prints each type with its file, each rule, and fixture: value → normalised name', () => {
    const w = world();
    typeOf(w, SUBNETWORK)['contains'] = [{ byParent: ROUTE }];
    typeOf(w, NETWORK)['aliases'] = ['$.data.name'];
    const trace = compile(w, OFFICIAL, [], { trace: true }).trace ?? [];
    const text = formatTrace(trace).join('\n');
    expect(text).toContain(`  ${NETWORK} (products/compute.googleapis.com.yaml)`);
    expect(text).toContain(
      `      //compute.googleapis.com/projects/demo-net-1/global/networks/core: ${SELF}/demo-partner-1/global/networks/partner → //compute.googleapis.com/projects/demo-partner-1/global/networks/partner`,
    );
    expect(text).toContain('      (nests children by their parent or name; nothing to read from the data)');
    expect(text).toContain('      //compute.googleapis.com/projects/demo-net-1/global/networks/core → core');
    expect(formatReport(compile(w).report, { trace })).toContain(
      'catalog:check: rule traces (rule → fixture value → normalised):',
    );
  });

  it('marks values that resolve to nothing, rules without a value, and templates with a missing variable', () => {
    const w = world();
    typeOf(w, SUBNETWORK)['ips'] = ['$.data.name', '$.data.missing'];
    typeOf(w, SUBNETWORK)['subtitle'] = '{{data.purpose}}';
    const text = formatTrace(compile(w, OFFICIAL, [], { trace: true }).trace ?? []).join('\n');
    expect(text).toContain(': app → (nothing: dangling or not a valid value)');
    expect(text).toContain('ips[1] $.data.missing\n      (no value on any fixture)');
    expect(text).toContain(' →  [a variable is missing]');
  });
});
