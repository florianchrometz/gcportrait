// SPDX-License-Identifier: Apache-2.0
/**
 * The website's build: one definition (.github/workflows/website.yml, a reusable workflow) called by
 * pages.yml (a push to main) and release.yml (a tag), so a second copy cannot drift
 * from it; a pull request runs CI's `website` job alone (pr.yml), and pages.yml does not repeat that gate
 * there (docs/contributing.md, "Continuous integration").
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

function read(file: string): string {
  return readFileSync(path.join(root, file), 'utf8');
}

describe('the website workflows', () => {
  const build = read('.github/workflows/website.yml');
  const pages = read('.github/workflows/pages.yml');
  const release = read('.github/workflows/release.yml');
  const pr = read('.github/workflows/pr.yml');

  it('define the build once, as a reusable workflow', () => {
    // Only `workflow_call`: a workflow that also ran itself would be a second definition again.
    expect(build).toMatch(/^on:\n {2}workflow_call:\n/m);
    for (const step of ['pnpm run demo:static', 'pnpm run website:build', 'pnpm run website:check']) {
      expect(build).toContain(step);
    }
    expect(build).toContain('pnpm run media --check');
  });

  it('are what pages.yml and release.yml call, neither of them building the site itself', () => {
    for (const [file, workflow] of [
      ['pages.yml', pages],
      ['release.yml', release],
    ] as const) {
      expect(workflow, file).toContain('uses: ./.github/workflows/website.yml');
      for (const step of ['demo:static', 'website:build', 'website:check']) {
        expect(workflow, file).not.toContain(`run: pnpm run ${step}`);
      }
    }
  });

  it('leave the pull request to CI: pages.yml does not run there', () => {
    expect(pages).not.toMatch(/^on:\n(?: {2}\S.*\n)*? {2}pull_request:/m);
    expect(pr).toContain('run: pnpm run website:build');
    expect(pr).toContain('run: pnpm run website:check');
  });

  it("keep a tag's refusal of stale media, which pages.yml only warns about", () => {
    expect(release).toMatch(/require-media: true\n/);
    expect(pages).not.toMatch(/require-media:/);
  });

  it('accurately describes the pr.yml website job in website.yml comments', () => {
    expect(build).toContain(
      "runs CI's\n# `website` job (pr.yml), which builds and checks the site and static demo without deploying.",
    );
  });
});
