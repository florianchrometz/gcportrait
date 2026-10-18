// SPDX-License-Identifier: Apache-2.0
import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'backend',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
