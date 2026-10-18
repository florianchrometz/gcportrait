// SPDX-License-Identifier: MIT
import { defineConfig } from 'vitest/config';

/**
 * The `model` test project. The root run (`pnpm test`) loads it as one of its projects and ignores the
 * coverage block below (coverage is a root-level option there); running Vitest in this package with
 * `--coverage` uses it and fails below the thresholds, as `pnpm test:coverage` (CI's `unit (coverage)`) does. That is why this file uses defineConfig rather than defineProject, whose type
 * has no coverage options.
 *
 * `pnpm --filter @gcportrait/model test -- --coverage` forwards the `--` to Vitest, which then stops reading
 * flags, so `--coverage` after it is honoured here explicitly. `pnpm --filter @gcportrait/model test
 * --coverage` works through Vitest's own flag.
 */
export default defineConfig({
  test: {
    name: 'model',
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The property tests' seed (src/testing/fast-check-seed.ts): FC_SEED, a fixed one on CI, else fresh.
    setupFiles: ['src/testing/fast-check-seed.ts'],
    coverage: {
      enabled: process.argv.includes('--coverage'),
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/testing/**'],
      reporter: [['text', { skipFull: false }], 'text-summary'],
      // Every schema branch is covered by tests. The codec is held to the same bar.
      thresholds: {
        'src/schemas/**': { branches: 100, functions: 100, lines: 100, statements: 100 },
        'src/codec/**': { branches: 100, functions: 100, lines: 100, statements: 100 },
      },
    },
  },
});
