// SPDX-License-Identifier: Apache-2.0
import path from 'node:path';

import { defineProject } from 'vitest/config';

export default defineProject({
  resolve: {
    // The diagram theme test reads the style skill's palette tables (src/diagram/theme/theme.test.ts) to check
    // the token table against them; the skills live outside every workspace package.
    alias: { '@agent-skills': path.resolve(import.meta.dirname, '../.agents/skills') },
  },
  test: {
    name: 'frontend',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    // Testing Library's cleanup (src/test/setup.ts) and the property tests' seed
    // (@gcportrait/model/testing/fast-check-seed: FC_SEED when set, a fixed one on CI, else fresh).
    setupFiles: ['./src/test/setup.ts', '@gcportrait/model/testing/fast-check-seed'],
    // CSS is stubbed in tests, except the diagram's token file, which theme.test.ts reads (`?raw`) to check it
    // against the token table.
    css: { include: [/diagram\/theme\/tokens\.css/] },
  },
});
