// SPDX-License-Identifier: MIT
/**
 * The changelog page, from the release notes' one source: the changesets. Released versions are the `## X.Y.Z`
 * sections `pnpm release:version` writes into the workspace packages' CHANGELOG.md files (one fixed group, so every
 * package carries the same version; an entry several packages list appears once, the changesets bookkeeping
 * "Updated dependencies" entries and commit hashes are left out, as scripts/release-notes.mjs does for GitHub
 * releases). What is not released yet is the pending changesets under .changeset/: the "Unreleased" section.
 */
import { readdirSync } from 'node:fs';
import path from 'node:path';

import { parse } from 'yaml';

import { renderMarkdown } from './markdown.js';
import { readRepoFile, repoRoot } from './repo.js';

export type Bump = 'major' | 'minor' | 'patch';

export type ChangeEntry = {
  readonly kind: Bump;
  readonly html: string;
  /** The packages the change names. */
  readonly packages: readonly string[];
  /** Where it came from: a changeset file, or a CHANGELOG.md. */
  readonly source: string;
};

export type ChangelogSection = {
  readonly version: string;
  readonly entries: readonly ChangeEntry[];
};

const BUMPS: readonly Bump[] = ['major', 'minor', 'patch'];

/** A changeset file's packages and bump (its front matter) and its summary. Exported for the tests. */
export function parseChangeset(text: string): {
  readonly packages: Record<string, Bump>;
  readonly summary: string;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (match === null) return { packages: {}, summary: text.trim() };
  const raw: unknown = parse(match[1] ?? '');
  const packages: Record<string, Bump> = {};
  if (typeof raw === 'object' && raw !== null) {
    for (const [name, bump] of Object.entries(raw as Record<string, unknown>)) {
      if (bump === 'major' || bump === 'minor' || bump === 'patch') packages[name] = bump;
    }
  }
  return { packages, summary: (match[2] ?? '').trim() };
}

function largest(bumps: readonly Bump[]): Bump {
  return BUMPS.find((bump) => bumps.includes(bump)) ?? 'patch';
}

/** Natural order of file names and versions (a-2 before a-10, 1.2.0 before 1.10.0). */
function natural(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true });
}

function render(markdown: string, sourcePath: string): string {
  return renderMarkdown(markdown, { sourcePath }).html;
}

/** The pending changesets, in the natural order of their file names. */
export function unreleased(): ChangeEntry[] {
  const dir = path.join(repoRoot(), '.changeset');
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort(natural);
  return names.flatMap((name) => {
    const text = readRepoFile(`.changeset/${name}`);
    if (text === undefined) return [];
    const { packages, summary } = parseChangeset(text);
    if (summary === '') return [];
    return [
      {
        kind: largest(Object.values(packages)),
        html: render(summary, `.changeset/${name}`),
        packages: Object.keys(packages).sort(),
        source: `.changeset/${name}`,
      },
    ];
  });
}

/**
 * The folders of the workspace packages outside packages/ (every packages/* folder is read as well). Not the root: its
 * CHANGELOG.md is the hand-written summary of a release, not changesets output, and each of its bullets would read as
 * an entry of its own.
 */
const CHANGELOG_DIRS = ['frontend', 'backend', 'e2e', 'website'];

/** The folders whose CHANGELOG.md the changelog page reads. Exported for the tests. */
export function changelogDirs(): string[] {
  const dirs = [...CHANGELOG_DIRS];
  const packagesDir = path.join(repoRoot(), 'packages');
  for (const name of readdirSync(packagesDir).sort()) dirs.push(`packages/${name}`);
  return dirs;
}

/** The released sections of every CHANGELOG.md in the workspace, newest version first. Exported for the tests. */
export function releasedSections(
  files: readonly { readonly path: string; readonly text: string }[],
): ChangelogSection[] {
  const byVersion = new Map<string, Map<string, ChangeEntry>>();
  for (const file of files) {
    let version: string | undefined;
    let kind: Bump = 'patch';
    let current: string[] | undefined;
    const flush = (): void => {
      if (version === undefined || current === undefined) return;
      const text = current
        .join('\n')
        .replace(/^- (?:[0-9a-f]{7,40}: )?/, '')
        .trim();
      current = undefined;
      if (text === '' || text.startsWith('Updated dependencies')) return;
      const entries = byVersion.get(version) ?? new Map<string, ChangeEntry>();
      if (!entries.has(text))
        entries.set(text, { kind, html: render(text, file.path), packages: [], source: file.path });
      byVersion.set(version, entries);
    };
    for (const line of file.text.replace(/\r\n?/g, '\n').split('\n')) {
      const heading = /^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*$/.exec(line);
      if (heading !== null) {
        flush();
        version = heading[1];
        continue;
      }
      const kindHeading = /^### (Major|Minor|Patch) Changes\s*$/.exec(line);
      if (kindHeading !== null) {
        flush();
        kind = (kindHeading[1] ?? 'Patch').toLowerCase() as Bump;
        continue;
      }
      if (version === undefined) continue;
      if (line.startsWith('- ')) {
        flush();
        current = [line];
      } else if (current !== undefined && (line.startsWith('  ') || line === '')) {
        current.push(line.replace(/^ {2}/, ''));
      }
    }
    flush();
  }
  return [...byVersion.entries()]
    .sort(([a], [b]) => -natural(a, b))
    .map(([version, entries]) => ({
      version,
      entries: [...entries.values()].sort((a, b) => BUMPS.indexOf(a.kind) - BUMPS.indexOf(b.kind)),
    }));
}

/** The CHANGELOG.md files changesets wrote, if any. */
export function changelogFiles(): { path: string; text: string }[] {
  return changelogDirs().flatMap((dir) => {
    const file = `${dir}/CHANGELOG.md`;
    const text = readRepoFile(file);
    return text === undefined ? [] : [{ path: file, text }];
  });
}
