// SPDX-License-Identifier: Apache-2.0
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';

import { CALLER_TOKEN, scopeOf, testClient } from '../upstream/google.testing.js';
import { pullCredentials } from './pull.js';

describe('pullCredentials', () => {
  it.each([true, false])(
    'refuses a missing service-account identity when enabled is %s',
    async (saModeEnabled) => {
      const app = Fastify();
      const fetch = vi.fn(() => Promise.reject(new Error('Unexpected upstream call')));
      app.get('/', async (request, reply) => {
        const signal = new AbortController().signal;
        const result = await pullCredentials(
          request,
          reply,
          { scope: scopeOf('projects/demo-app-1'), mode: 'sa' },
          CALLER_TOKEN,
          { saModeEnabled, serviceAccount: null, upstream: testClient(fetch) },
          'assets.stream',
          signal,
        );
        return result.ok ? result.credentials(signal) : result.reply;
      });
      try {
        const response = await app.inject('/');
        expect(response.statusCode).toBe(500);
        expect(response.json()).toMatchObject({
          message: 'Service-account mode requires an instance identity.',
        });
        expect(response.body).not.toContain(CALLER_TOKEN);
        expect(fetch).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    },
  );
});
