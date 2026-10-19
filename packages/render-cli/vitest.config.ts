// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vitest/config';

/**
 * The `render-cli` test project: argument parsing, the comparison helpers, byte stability
 * (two runs, in process and through the command line), the SVG against the renderer's own baselines and the
 * golden PNG under e2e/baselines/render/. Rendering and rasterising demo views takes seconds, hence the timeout.
 */
export default defineConfig({
  test: {
    name: 'render-cli',
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: {
      enabled: process.argv.includes('--coverage'),
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts', 'src/cli.ts'],
      reporter: [['text', { skipFull: false }], 'text-summary'],
    },
  },
});
