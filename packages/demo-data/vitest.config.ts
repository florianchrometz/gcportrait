// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vitest/config';

/**
 * The `demo-data` test project. `src/**` holds the pure unit tests; `scripts/**` holds the tests that read the
 * committed fixtures and run the `generate` command. The performance tests generate the XL organisation (≈50 000
 * assets), hence the generous timeout.
 *
 * Like the model and graph packages it uses defineConfig, whose type has the coverage options, so that
 * `pnpm --filter @gcportrait/demo-data exec vitest run --coverage` reports coverage; the root run ignores the
 * coverage block. It holds no thresholds, so `pnpm test:coverage` leaves it out. The spawned `generate` command runs in a child process, which V8 coverage
 * does not follow.
 */
export default defineConfig({
  test: {
    name: 'demo-data',
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    testTimeout: 60_000,
    coverage: {
      enabled: process.argv.includes('--coverage'),
      provider: 'v8',
      include: ['src/**/*.ts'],
      // index.ts only re-exports; testing.ts and testing/ hold test helpers and test data.
      exclude: ['src/**/*.test.ts', 'src/testing.ts', 'src/testing/**', 'src/index.ts'],
      reporter: [['text', { skipFull: false }], 'text-summary'],
    },
  },
});
