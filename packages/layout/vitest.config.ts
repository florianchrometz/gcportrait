// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vitest/config';

/**
 * The `layout` test project: pure unit and property tests next to the code (src/), and under test/ the golden
 * layouts of the demo organisations, the metrics staleness check and the performance budget. Like the graph
 * package it uses defineConfig so that `pnpm --filter @gcportrait/layout test -- --coverage` reports
 * coverage; the root run ignores the coverage block.
 */
export default defineConfig({
  test: {
    name: 'layout',
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'scripts/**/*.test.ts'],
    // The property tests' seed (test/fast-check-seed.ts): FC_SEED when set, a fixed one on CI, else fresh.
    setupFiles: ['test/fast-check-seed.ts'],
    testTimeout: 60_000,
    // The performance test skips its budgets under coverage instrumentation (test/performance.test.ts).
    env: { LAYOUT_COVERAGE: process.argv.includes('--coverage') ? '1' : '' },
    coverage: {
      enabled: process.argv.includes('--coverage'),
      provider: 'v8',
      include: ['src/**/*.ts'],
      // index.ts only re-exports; testing/ holds test helpers.
      exclude: ['src/**/*.test.ts', 'src/testing/**', 'src/index.ts'],
      reporter: [['text', { skipFull: false }], 'text-summary'],
      thresholds: { statements: 98, branches: 95, functions: 100, lines: 98 },
    },
  },
});
