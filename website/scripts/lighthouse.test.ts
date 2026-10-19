// SPDX-License-Identifier: Apache-2.0
import { execFile } from 'node:child_process';
import { existsSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const WEBSITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSX = path.join(WEBSITE, 'node_modules', '.bin', 'tsx');
const SCRIPT = path.join(WEBSITE, 'scripts', 'lighthouse.ts');

describe('lighthouse CLI options', () => {
  it('rejects an unknown --theme flag with exit code 2', async () => {
    try {
      await execFileAsync(TSX, [SCRIPT, '--theme', 'neon']);
      expect.unreachable('should have failed');
    } catch (error: unknown) {
      const err = error as { code: number; stderr: string };
      expect(err.code).toBe(2);
      expect(err.stderr).toContain('website lighthouse: --theme neon: light or dark');
    }
  }, 15_000);

  it('rejects an unknown --preset flag with exit code 2', async () => {
    try {
      await execFileAsync(TSX, [SCRIPT, '--preset', 'tablet']);
      expect.unreachable('should have failed');
    } catch (error: unknown) {
      const err = error as { code: number; stderr: string };
      expect(err.code).toBe(2);
      expect(err.stderr).toContain('website lighthouse: --preset tablet: desktop or mobile');
    }
  }, 15_000);

  it('reports missing sitemap.xml with exit code 1 when sitemap is missing', async () => {
    const sitemap = path.join(WEBSITE, 'dist', 'sitemap.xml');
    const backup = path.join(WEBSITE, 'dist', 'sitemap.xml.bak');
    const existed = existsSync(sitemap);
    if (existed) renameSync(sitemap, backup);
    try {
      await execFileAsync(TSX, [SCRIPT]);
      expect.unreachable('should have failed when dist/sitemap.xml is missing');
    } catch (error: unknown) {
      const err = error as { code: number; stderr: string };
      expect(err.code).toBe(1);
      expect(err.stderr).toContain(
        'website/dist/sitemap.xml is missing; run pnpm --filter @gcportrait/website build first.',
      );
    } finally {
      if (existed && existsSync(backup)) renameSync(backup, sitemap);
    }
  }, 15_000);
});
