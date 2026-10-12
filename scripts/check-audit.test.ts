// SPDX-License-Identifier: MIT
/**
 * scripts/check-audit.mjs: the audit gate on saved `pnpm audit --json` reports (synthetic advisories,
 * no network) and its allowlist with expiry dates.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  ALLOWLIST_PATH,
  advisoriesOf,
  AuditInputError,
  evaluateAudit,
  parseAllowlist,
} from './check-audit.mjs';
import { createTempTree, REPO, runScript, type TempTree } from './testing/temp-tree.js';

const GHSA_HIGH = 'GHSA-2222-3333-4444';
const GHSA_CRITICAL = 'GHSA-5555-6666-7777';
const GHSA_MODERATE = 'GHSA-8888-9999-cccc';

function advisory(id: number, ghsa: string, module: string, severity: string) {
  return {
    id,
    github_advisory_id: ghsa,
    module_name: module,
    severity,
    title: `Synthetic ${severity} advisory in ${module}`,
    url: `https://github.com/advisories/${ghsa}`,
    vulnerable_versions: '<1.2.4',
    patched_versions: '>=1.2.4',
    findings: [{ version: '1.2.3', paths: [`.>${module}`] }],
  };
}

function report(...entries: ReturnType<typeof advisory>[]) {
  return {
    actions: [],
    advisories: Object.fromEntries(entries.map((entry) => [String(entry.id), entry])),
    muted: [],
    metadata: { vulnerabilities: {}, dependencies: 1 },
  };
}

const REASON = 'Only reachable through a code path gcportrait never calls (synthetic).';

describe('evaluateAudit', () => {
  it('passes a clean tree', () => {
    expect(evaluateAudit({ production: [], all: [], allowlist: [], today: '2026-10-11' })).toEqual({
      failures: [],
      accepted: [],
      reported: [],
      unused: [],
    });
  });

  it('fails on a high or critical advisory, in production or development dependencies alike', () => {
    const verdict = evaluateAudit({
      production: advisoriesOf(report(advisory(1, GHSA_HIGH, 'a-prod', 'high')), 'production'),
      all: advisoriesOf(
        report(advisory(1, GHSA_HIGH, 'a-prod', 'high'), advisory(2, GHSA_CRITICAL, 'd-dev', 'critical')),
        'development',
      ),
      allowlist: [],
      today: '2026-10-11',
    });
    expect(verdict.failures).toHaveLength(2);
    expect(verdict.failures[0]).toContain(
      `${GHSA_HIGH} high in a-prod <1.2.4 (production; fixed in >=1.2.4)`,
    );
    expect(verdict.failures[1]).toContain(`${GHSA_CRITICAL} critical in d-dev <1.2.4 (development;`);
    expect(verdict.failures[1]).toContain('not in scripts/audit-allowlist.json');
  });

  it('lists moderate and low advisories without failing', () => {
    const verdict = evaluateAudit({
      production: [],
      all: advisoriesOf(report(advisory(3, GHSA_MODERATE, 'm-mod', 'moderate')), 'development'),
      allowlist: [],
      today: '2026-10-11',
    });
    expect(verdict.failures).toEqual([]);
    expect(verdict.reported).toHaveLength(1);
  });

  it('accepts an allowlisted advisory until its expiry, and fails it from the day after', () => {
    const input = {
      production: advisoriesOf(report(advisory(1, GHSA_HIGH, 'a-prod', 'high')), 'production'),
      all: [],
      allowlist: [
        { id: GHSA_HIGH, package: 'a-prod', reason: REASON, added: '2026-10-01', expires: '2026-10-31' },
      ],
    } as const;
    const open = evaluateAudit({ ...input, today: '2026-10-31' });
    expect(open.failures).toEqual([]);
    expect(open.accepted[0]).toContain(`accepted until 2026-10-31: ${REASON}`);
    const expired = evaluateAudit({ ...input, today: '2026-11-01' });
    expect(expired.failures[0]).toContain('its acceptance expired on 2026-10-31: fix it or renew the entry');
  });

  it('matches an entry by advisory id and package, never by id alone', () => {
    const verdict = evaluateAudit({
      production: advisoriesOf(report(advisory(1, GHSA_HIGH, 'a-prod', 'high')), 'production'),
      all: [],
      allowlist: [
        { id: GHSA_HIGH, package: 'other', reason: REASON, added: '2026-10-01', expires: '2026-10-31' },
      ],
      today: '2026-10-11',
    });
    expect(verdict.failures).toHaveLength(1);
    expect(verdict.unused).toEqual([`${GHSA_HIGH} (other): no longer reported; remove the entry`]);
  });

  it('refuses an acceptance longer than 90 days', () => {
    const verdict = evaluateAudit({
      production: [],
      all: [],
      allowlist: [
        { id: GHSA_HIGH, package: 'a-prod', reason: REASON, added: '2026-10-01', expires: '2027-01-15' },
      ],
      today: '2026-10-11',
    });
    expect(verdict.failures[0]).toContain('longer than 90 days');
  });

  it('refuses an entry added after today, which would run for more than 90 days from today', () => {
    const verdict = evaluateAudit({
      production: advisoriesOf(report(advisory(1, GHSA_HIGH, 'a-prod', 'high')), 'production'),
      all: [],
      allowlist: [
        { id: GHSA_HIGH, package: 'a-prod', reason: REASON, added: '2026-12-01', expires: '2027-02-28' },
      ],
      today: '2026-10-11',
    });
    expect(verdict.failures).toEqual([
      `${GHSA_HIGH} (a-prod): "added" is 2026-12-01, after today (2026-10-11); an acceptance starts on the day ` +
        'it is written',
    ]);
    expect(verdict.accepted).toHaveLength(1);
  });
});

describe('parseAllowlist', () => {
  it.each([
    [{}, 'expected an object with an "advisories" array'],
    [
      {
        advisories: [
          { id: 'CVE-2026-1', package: 'x', reason: REASON, added: '2026-10-01', expires: '2026-10-02' },
        ],
      },
      '"id" must be',
    ],
    [
      {
        advisories: [
          { id: GHSA_HIGH, package: '', reason: REASON, added: '2026-10-01', expires: '2026-10-02' },
        ],
      },
      '"package" is required',
    ],
    [
      {
        advisories: [
          { id: GHSA_HIGH, package: 'x', reason: 'ok', added: '2026-10-01', expires: '2026-10-02' },
        ],
      },
      '"reason" must say why',
    ],
    [
      { advisories: [{ id: GHSA_HIGH, package: 'x', reason: REASON, added: '2026-10-01', expires: 'soon' }] },
      'is not a date',
    ],
    [
      {
        advisories: [
          { id: GHSA_HIGH, package: 'x', reason: REASON, added: '2026-10-02', expires: '2026-10-01' },
        ],
      },
      '"expires" is before "added"',
    ],
  ])('refuses %j', (document, message) => {
    expect(() => parseAllowlist(document)).toThrow(AuditInputError);
    expect(() => parseAllowlist(document)).toThrow(message);
  });
});

describe('advisoriesOf', () => {
  it('turns a failed audit into an input error, not a pass', () => {
    expect(() =>
      advisoriesOf(
        { error: { code: 'ERR_PNPM_AUDIT_BAD_RESPONSE', summary: 'registry down' } },
        'production',
      ),
    ).toThrow('pnpm audit failed: registry down');
    expect(() => advisoriesOf('No known vulnerabilities found', 'production')).toThrow(AuditInputError);
  });
});

describe('check-audit.mjs on saved reports', () => {
  let tree: TempTree | undefined;
  afterEach(() => {
    tree?.remove();
    tree = undefined;
  });

  function run(prod: unknown, all: unknown, allowlist: unknown, today = '2026-10-11') {
    tree?.remove();
    tree = createTempTree('audit');
    tree.write('prod.json', JSON.stringify(prod));
    tree.write('all.json', JSON.stringify(all));
    tree.write('allowlist.json', JSON.stringify(allowlist));
    return runScript('check-audit.mjs', [
      '--prod-report',
      `${tree.root}/prod.json`,
      '--all-report',
      `${tree.root}/all.json`,
      '--allowlist',
      `${tree.root}/allowlist.json`,
      '--today',
      today,
    ]);
  }

  it('exits 0 on a clean tree', () => {
    const result = run(report(), report(), { advisories: [] });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('audit: OK on 2026-10-11.');
  });

  it('exits 1 on an open high advisory and names it', () => {
    const result = run(report(), report(advisory(9, GHSA_HIGH, 'd-dev', 'high')), { advisories: [] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('audit: FAILED with 1 problem(s) (high and critical fail):');
    expect(result.stderr).toContain(GHSA_HIGH);
  });

  it('exits 2 on a malformed report or an unknown option', () => {
    expect(run({ error: { summary: 'offline' } }, report(), { advisories: [] }).status).toBe(2);
    expect(runScript('check-audit.mjs', ['--nope']).status).toBe(2);
  });

  it('names the allowlist it read, not the default one, and exits 2 when it is malformed', () => {
    const open = run(report(), report(advisory(9, GHSA_HIGH, 'd-dev', 'high')), { advisories: [] });
    expect(open.stderr).toContain(`not in ${tree?.root ?? ''}/allowlist.json`);
    expect(open.stderr).not.toContain('scripts/audit-allowlist.json');
    const malformed = run(report(), report(), { advisories: 'none' });
    expect(malformed.status).toBe(2);
    expect(malformed.stderr).toContain(`${tree?.root ?? ''}/allowlist.json: expected an object`);
    expect(run(report(), report(), { advisories: [] }).stdout).toContain(
      `0 accepted in ${tree?.root ?? ''}/allowlist.json`,
    );
  });

  it('keeps the repository allowlist valid', () => {
    const document: unknown = JSON.parse(readFileSync(path.join(REPO, ALLOWLIST_PATH), 'utf8'));
    expect(() => parseAllowlist(document)).not.toThrow();
  });
});
