// SPDX-License-Identifier: MIT
import { defineConfig } from 'vitest/config';

/**
 * Root Vitest config: `pnpm test` runs every project below in one process. Each workspace package keeps its
 * own vitest.config.ts (environment, includes), so `pnpm --filter <pkg> test` behaves the same as the root run.
 * e2e/ is not a Vitest project; it runs under Playwright.
 *
 * Coverage (V8) is configured but not enforced yet: `pnpm test --coverage` writes reports to coverage/.
 * The scripts/*.mjs command-line tools are tested end to end in child processes, which V8 coverage does not
 * follow, so their coverage figure reads far lower than what the tooling tests actually exercise.
 */
export default defineConfig({
  test: {
    projects: [
      'packages/*',
      '{frontend,backend,website}/vitest.config.ts',
      {
        test: {
          name: 'tooling',
          include: ['scripts/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text-summary', 'html', 'lcov'],
      include: [
        'packages/*/src/**',
        'frontend/src/**',
        'backend/src/**',
        'website/src/**',
        'scripts/**/*.mjs',
      ],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts'],
    },
  },
});
