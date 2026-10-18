// SPDX-License-Identifier: Apache-2.0
import { defineProject } from 'vitest/config';

/**
 * The `catalog` test project: the rule engine and compiler under src/ (pure), and under tooling/ the tests that
 * compile and check the real data files and exercise the command-line tools.
 */
export default defineProject({
  test: {
    name: 'catalog',
    environment: 'node',
    include: ['src/**/*.test.ts', 'tooling/**/*.test.ts'],
    // The property tests' seed (src/testing/fast-check-seed.ts): FC_SEED, a fixed one on CI, else fresh.
    setupFiles: ['src/testing/fast-check-seed.ts'],
  },
});
