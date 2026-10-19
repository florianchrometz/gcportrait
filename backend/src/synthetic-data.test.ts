// SPDX-License-Identifier: Apache-2.0
/**
 * No real organisation data in the backend's tests (AGENTS.md, Security and privacy, principle 6): every test
 * and test helper under src/, found by name so a new one is checked without being listed, and the two files
 * of other areas that the service-account tests' data reaches (the e2e spec that drives the harness, and the
 * permissions guide whose cases they mirror), which this test only reads. A few files hold a value the guard
 * flags on purpose; each is exempted here by value, with the reason, so anything else in them is still
 * checked.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { findNonSyntheticData } from '@gcportrait/model/testing';
import { describe, expect, it } from 'vitest';

const REPOSITORY = path.resolve(import.meta.dirname, '../..');

const FILES = [
  ...readdirSync(import.meta.dirname, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(?:test|testing)\.ts$/.test(file))
    .map((file) => path.posix.join('backend/src', file.split(path.sep).join('/'))),
  'e2e/tests/sa-mode.spec.ts',
  'docs/permissions.md',
].sort();

/** What the guard may find in a file, and why it is there. */
interface Exemption {
  readonly reason: string;
  readonly allowed: readonly RegExp[];
}

const EXEMPTIONS: Readonly<Record<string, Exemption>> = {
  'backend/src/config.test.ts': {
    reason: 'pins DEFAULT_SOURCE_URL, the project repository a fork changes (docs/contributing.md, Releases)',
    allowed: [/^github\.com$/],
  },
  'backend/src/render/bundle.test.ts': {
    reason: 'reads the bundle’s notices: the npm registry the MPL-2.0 package’s source is at',
    allowed: [/^registry\.npmjs\.org$/],
  },
  'backend/src/render/job.test.ts': {
    reason: 'the PNG refusal names a diagram editor’s file format, whose name is a host name too',
    allowed: [/^draw\.io$/],
  },
  'backend/src/routes/render.test.ts': {
    reason: 'the render options’ message names a diagram editor’s file format, whose name is a host name too',
    allowed: [/^draw\.io$/],
  },
  'backend/src/server.test.ts': {
    reason: 'the SVG namespace of the stand-in favicon',
    allowed: [/^www\.w3\.org$/],
  },
  'backend/src/routes/preflight.test.ts': {
    reason: 'a scope the route must refuse: an organisation id with an email address after it',
    allowed: [/^organizations\/1$/],
  },
  'backend/src/upstream/allowlist-attacks.test.ts': {
    reason: 'the attacks: hosts and user info the allowlist must refuse',
    allowed: [/^evil\.com$/, /^(?:user|pass)@cloudasset\.googleapis\.com$/],
  },
  'backend/src/upstream/scope.test.ts': {
    reason: 'ids the scope parser must refuse',
    allowed: [/^organizations\/(?:0123|12)$/, /^evil\.com$/],
  },
};

const findingsOf = (file: string): string[] =>
  findNonSyntheticData(readFileSync(path.join(REPOSITORY, file), 'utf8')).map(
    (finding) => `${finding.kind} ${finding.value} (line ${String(finding.line)})`,
  );

const valueOf = (finding: string): string => finding.split(' ')[1] ?? '';

describe('the backend tests’ data', () => {
  it.each(FILES)('%s is synthetic', (file) => {
    const allowed = EXEMPTIONS[file]?.allowed ?? [];
    const findings = findingsOf(file).filter(
      (finding) => !allowed.some((pattern) => pattern.test(valueOf(finding))),
    );
    expect(findings).toEqual([]);
  });

  it('finds every test and helper, the harnesses among them', () => {
    expect(FILES).toEqual(
      expect.arrayContaining([
        'backend/src/auth/sa-harness.testing.ts',
        'backend/src/demo-only-harness.testing.ts',
        'backend/src/synthetic-data.test.ts',
        'backend/src/upstream/google.testing.ts',
      ]),
    );
  });

  it.each(Object.entries(EXEMPTIONS))('exempts in %s only what is still there', (file, { allowed }) => {
    const values = findingsOf(file).map(valueOf);
    for (const pattern of allowed)
      expect(
        values.some((value) => pattern.test(value)),
        String(pattern),
      ).toBe(true);
  });
});
