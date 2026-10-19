// SPDX-License-Identifier: Apache-2.0
import { defineProject } from 'vitest/config';

/**
 * The `icons` test project: the lookups and the fallback chain under src/ (pure), and under scripts/ the
 * mechanical SVG transforms, the zip reader, and the guards that run on the committed data: every icon key the
 * catalog uses resolves, no icon exceeds 8 kB, the vendored files still match the manifest's hashes and
 * colours, and the generated module is not stale.
 */
export default defineProject({
  test: {
    name: 'icons',
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
