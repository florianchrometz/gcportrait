// SPDX-License-Identifier: MIT
import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'website',
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
