// SPDX-License-Identifier: MIT
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { DEFAULT_SOURCE_URL } from '../config.js';
import { PublicConfigResponseSchema } from '../schemas.js';
import { startTestServer } from '../server.testing.js';
import { hostedByLine } from './config.js';

/** A server whose environment is `env` over the test defaults. */
async function start(env: Record<string, string> = {}) {
  return (await startTestServer({ env })).app;
}

describe('GET /api/config', () => {
  // Compared as sent and as the schema reads it: exactly the declared fields, and nothing that needs a sign-in.
  it('reports nulls and SA mode off when nothing is configured: no one named as the host', async () => {
    const app = await start();
    const response = await app.inject({ method: 'GET', url: '/api/config' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body: unknown = response.json();
    expect(PublicConfigResponseSchema.parse(body)).toEqual(body);
    expect(body).toEqual({
      oauthClientId: null,
      saMode: false,
      saStrictExposure: false,
      backendServiceAccount: null,
      version: '9.9.9-test',
      sourceUrl: DEFAULT_SOURCE_URL,
      hostedBy: null,
      demo: false,
      demoOnly: false,
      legal: { impressum: false, privacy: false, impressumUrl: null, privacyUrl: null },
      render: { maxAssets: 60000, maxPixels: 67108864, maxBodyBytes: 26214400, timeoutMs: 300000 },
    });
  });

  it('reflects the environment', async () => {
    const app = await start({
      OAUTH_CLIENT_ID: '12345678901-abc.apps.googleusercontent.com',
      SA_MODE_ENABLED: 'true',
      BACKEND_SA_EMAIL: 'gcportrait-backend@example.com',
      SOURCE_URL: 'https://git.example.org/team/gcportrait-fork',
      HOSTED_BY: 'Example Ltd.',
      RENDER_MAX_ASSETS: '1000',
      RENDER_MAX_PIXELS: '1000000',
      RENDER_TIMEOUT_MS: '10000',
      RENDER_MAX_BODY_BYTES: '1048576',
    });
    const response = await app.inject({ method: 'GET', url: '/api/config' });
    expect(response.json()).toEqual({
      oauthClientId: '12345678901-abc.apps.googleusercontent.com',
      saMode: true,
      saStrictExposure: false,
      backendServiceAccount: 'gcportrait-backend@example.com',
      version: '9.9.9-test',
      sourceUrl: 'https://git.example.org/team/gcportrait-fork',
      hostedBy: 'Hosted by Example Ltd.',
      demo: false,
      demoOnly: false,
      legal: { impressum: false, privacy: false, impressumUrl: null, privacyUrl: null },
      render: { maxAssets: 1000, maxPixels: 1000000, maxBodyBytes: 1048576, timeoutMs: 10000 },
    });
    // RENDER_API=false: the route is off, and so is its entry.
    const off = await start({ RENDER_API: 'false' });
    expect((await off.inject({ method: 'GET', url: '/api/config' })).json()).toMatchObject({ render: null });
  });

  it('names the legal pages it serves as texts and the addresses of those it links', async () => {
    const legal = mkdtempSync(path.join(tmpdir(), 'gcportrait-config-legal-'));
    try {
      writeFileSync(path.join(legal, 'impressum.md'), '# Impressum\n\nExample Operator\n');
      const app = await start({
        LEGAL_DIR: legal,
        LEGAL_PRIVACY_URL: 'https://operator.example.com/legal/privacy',
      });
      const body = PublicConfigResponseSchema.parse(
        (await app.inject({ method: 'GET', url: '/api/config' })).json(),
      );
      expect(body.legal).toEqual({
        impressum: true,
        privacy: false,
        impressumUrl: null,
        privacyUrl: 'https://operator.example.com/legal/privacy',
      });
      // Both pages linked, none served: the booleans of today's app stay false, so its footer shows no page it
      // cannot serve, and the addresses are there for the footer that links them.
      const linked = await start({
        LEGAL_IMPRESSUM_URL: 'https://operator.example.com/legal/impressum',
        LEGAL_PRIVACY_URL: 'https://operator.example.com/legal/privacy',
      });
      expect((await linked.inject({ method: 'GET', url: '/api/config' })).json()).toMatchObject({
        legal: {
          impressum: false,
          privacy: false,
          impressumUrl: 'https://operator.example.com/legal/impressum',
          privacyUrl: 'https://operator.example.com/legal/privacy',
        },
      });
      expect(
        Object.keys(
          (await linked.inject({ method: 'GET', url: '/api/config' })).json<{ legal: object }>().legal,
        ).sort(),
      ).toEqual(['impressum', 'impressumUrl', 'privacy', 'privacyUrl']);
    } finally {
      rmSync(legal, { recursive: true, force: true });
    }
  });
});

describe('hostedByLine', () => {
  it.each([
    [null, null],
    ['Example Operator', 'Hosted by Example Operator.'],
    // A name that ends with a full stop gets no second one.
    ['Example Ltd.', 'Hosted by Example Ltd.'],
    // Nothing left once the full stops go: no line.
    ['...', null],
  ])('names whoever runs the instance (%j), and nothing else', (hostedBy, line) => {
    expect(hostedByLine(hostedBy)).toBe(line);
  });

  it('carries no non-affiliation line: the footer says it (ADR 0018)', () => {
    expect(hostedByLine('Example Operator')).not.toMatch(/affiliated/i);
  });
});
