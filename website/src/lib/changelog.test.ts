// SPDX-License-Identifier: MIT
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { changelogDirs, changelogFiles, parseChangeset, releasedSections, unreleased } from './changelog.js';
import { repoRoot } from './repo.js';

describe('the changelog', () => {
  it('reads a changeset’s packages, bumps and summary', () => {
    const parsed = parseChangeset(
      "---\n'@gcportrait/frontend': minor\n'@gcportrait/backend': patch\n---\n\nA change.\n",
    );
    expect(parsed.packages).toEqual({ '@gcportrait/frontend': 'minor', '@gcportrait/backend': 'patch' });
    expect(parsed.summary).toBe('A change.');
  });

  it('lists every pending changeset of the repository as unreleased, in the natural order of their names', () => {
    const entries = unreleased();
    // Every changeset in .changeset/ with a summary (an empty one has nothing to list); none on a release commit
    // and its tag, after `pnpm release:version` has consumed them.
    const dir = path.join(repoRoot(), '.changeset');
    const pending = readdirSync(dir).filter(
      (name) =>
        name.endsWith('.md') &&
        name !== 'README.md' &&
        parseChangeset(readFileSync(path.join(dir, name), 'utf8')).summary !== '',
    );
    expect(entries.length).toBe(pending.length);
    for (const entry of entries) {
      expect(entry.html.length, entry.source).toBeGreaterThan(0);
      expect(entry.source).toMatch(/^\.changeset\/.+\.md$/);
    }
    const sources = entries.map((entry) => entry.source);
    expect(sources).toEqual([...sources].sort((a, b) => a.localeCompare(b, 'en', { numeric: true })));
  });

  it('reads the CHANGELOG.md of every workspace package, never the root’s hand-written release summary', () => {
    const root = repoRoot();
    const workspace = parse(readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')) as {
      readonly packages: readonly string[];
    };
    const packageDirs = workspace.packages.flatMap((entry) => {
      if (!entry.endsWith('/*')) return [entry];
      const base = entry.slice(0, -2);
      return readdirSync(path.join(root, base))
        .filter((name) => existsSync(path.join(root, base, name, 'package.json')))
        .map((name) => `${base}/${name}`);
    });
    const dirs = changelogDirs();
    for (const dir of packageDirs) expect(dirs, dir).toContain(dir);
    expect(dirs).not.toContain('');
    // The root CHANGELOG.md exists and is not read: a `## 1.0.0` there would turn each of its bullets into an entry.
    expect(existsSync(path.join(root, 'CHANGELOG.md'))).toBe(true);
    expect(changelogFiles().map((file) => file.path)).not.toContain('CHANGELOG.md');
  });

  it('shows the repository’s own 1.0.0 release as one major entry: the release summary of CHANGELOG.md', () => {
    const release = releasedSections(changelogFiles()).find((section) => section.version === '1.0.0');
    expect(release?.entries.map((entry) => entry.kind)).toEqual(['major']);
    const html = release?.entries[0]?.html ?? '';
    expect(html.startsWith('<p>The first release of gcportrait.</p>')).toBe(true);
    for (const heading of [
      'Highlights',
      'Diagrams',
      'Timeline',
      'Self-hosting',
      'Known limitations',
      'Licence',
    ])
      expect(html).toContain(`>${heading}</h3>`);
    expect(html.replace(/\s+/g, ' ').split('is not affiliated with').length - 1).toBe(1);
    expect(html).not.toContain('Updated dependencies');
  });

  it('merges the released sections of the packages’ CHANGELOG.md files, newest first, without bookkeeping', () => {
    const backend =
      '# @gcportrait/backend\n\n## 1.1.0\n\n### Minor Changes\n\n- 1a2b3c4: Shared change.\n  Second line.\n- 9f9f9f9: Backend only.\n\n### Patch Changes\n\n- Updated dependencies [1a2b3c4]\n  - @gcportrait/model@1.1.0\n\n## 1.0.0\n\n### Major Changes\n\n- 0000000: First.\n';
    const frontend =
      '# @gcportrait/frontend\n\n## 1.1.0\n\n### Minor Changes\n\n- 1a2b3c4: Shared change.\n  Second line.\n';
    const sections = releasedSections([
      { path: 'backend/CHANGELOG.md', text: backend },
      { path: 'frontend/CHANGELOG.md', text: frontend },
    ]);
    expect(sections.map((section) => section.version)).toEqual(['1.1.0', '1.0.0']);
    expect(sections[0]?.entries.map((entry) => entry.kind)).toEqual(['minor', 'minor']);
    expect(sections[0]?.entries[0]?.html).toContain('Shared change.\nSecond line.');
    expect(sections[0]?.entries.some((entry) => entry.html.includes('Updated dependencies'))).toBe(false);
    expect(sections[1]?.entries[0]?.kind).toBe('major');
  });
});
