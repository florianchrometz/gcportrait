// SPDX-License-Identifier: MIT
import { defineConfig } from 'vitest/config';

/**
 * The `render` test project: the WOFF unwrapper, the fonts and the asset directory, the rasteriser, the snapshot
 * readers against the app's import, and `renderView` against the renderer's SVG baselines and the golden PNG, byte for
 * byte. Rendering and rasterising demo views takes seconds, hence the timeout.
 */
export default defineConfig({
  test: {
    name: 'render',
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    coverage: {
      enabled: process.argv.includes('--coverage'),
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/index.ts'],
      reporter: [['text', { skipFull: false }], 'text-summary'],
    },
  },
});
