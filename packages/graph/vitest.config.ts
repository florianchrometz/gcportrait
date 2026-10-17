// SPDX-License-Identifier: MIT
import { defineConfig } from 'vitest/config';

/**
 * The `graph` test project: pure unit and property tests next to the code (src/), under test/ the tests on
 * the demo organisations S, M and L (the build-time budget and the scene composition table included), and
 * under scripts/ the render-scene command's tests. Like the model package it uses
 * defineConfig so that `pnpm --filter @gcportrait/graph test -- --coverage` reports coverage; the root run
 * ignores the coverage block.
 */
export default defineConfig({
  test: {
    name: 'graph',
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'scripts/**/*.test.ts'],
    // The property tests' seed (test/fast-check-seed.ts): FC_SEED when set, a fixed one on CI, else fresh.
    setupFiles: ['test/fast-check-seed.ts'],
    testTimeout: 60_000,
    coverage: {
      enabled: process.argv.includes('--coverage'),
      provider: 'v8',
      include: ['src/**/*.ts'],
      // index.ts only re-exports; testing/ holds test helpers.
      exclude: ['src/**/*.test.ts', 'src/testing/**', 'src/index.ts'],
      reporter: [['text', { skipFull: false }], 'text-summary'],
      // Pure core: everything is tested. The few uncovered branches are `?? ''` fallbacks
      // that noUncheckedIndexedAccess requires but valid input cannot reach.
      thresholds: { statements: 99, branches: 95, functions: 100, lines: 100 },
    },
  },
});
