// SPDX-License-Identifier: MIT
import { defineConfig } from 'vitest/config';

/**
 * The `ingest` test project: pure unit tests next to the code (src/) and the Node-only tests (test/: fixture
 * files, the worker_threads harness and the 50 000-asset budget). Like the model package, it uses
 * defineConfig so that `pnpm --filter @gcportrait/ingest test -- --coverage` can enforce its thresholds;
 * the root run ignores the coverage block.
 */
export default defineConfig({
  test: {
    name: 'ingest',
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // The property tests' seed (test/fast-check-seed.ts): FC_SEED when set, a fixed one on CI, else fresh.
    setupFiles: ['test/fast-check-seed.ts'],
    coverage: {
      enabled: process.argv.includes('--coverage'),
      provider: 'v8',
      include: ['src/**/*.ts'],
      // index.ts only re-exports.
      exclude: ['src/**/*.test.ts', 'src/testing/**', 'src/index.ts'],
      reporter: [['text', { skipFull: false }], 'text-summary'],
      // Pure core: everything is unit-tested. The few uncovered branches are defensive
      // fallbacks that valid input cannot reach (an empty zod issue list, a non-Error thrown by JSON.parse).
      thresholds: { statements: 99, branches: 98, functions: 100, lines: 100 },
    },
  },
});
