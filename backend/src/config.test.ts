// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  configWarnings,
  DEFAULT_SOURCE_URL,
  DEFAULT_STATIC_DIR,
  parseConfig,
  readPackageVersion,
} from './config.js';
import { configRefusal } from './server.testing.js';

/** A refused text value: variable, value, the reason expected, and any other variable the scenario sets. */
type TextRefusal = [name: string, value: string, reason: RegExp, context?: Record<string, string>];

describe('parseConfig', () => {
  it('applies the documented defaults to an empty environment', () => {
    const config = parseConfig({});
    expect(config).toEqual({
      port: 8080,
      host: '0.0.0.0',
      logLevel: 'info',
      logFormat: 'json',
      oauthClientId: null,
      saModeEnabled: false,
      saStrictExposure: false,
      saAuditKey: null,
      saCallers: [],
      backendServiceAccount: null,
      hostedBy: null,
      staticDir: DEFAULT_STATIC_DIR,
      trustProxyHops: 0,
      version: readPackageVersion(),
      sourceUrl: DEFAULT_SOURCE_URL,
      demoOnly: false,
      legal: { impressum: null, privacy: null },
      legalUrls: { impressum: null, privacy: null },
      render: { maxAssets: 60000, maxPixels: 67108864, timeoutMs: 300000, maxBodyBytes: 26214400 },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(DEFAULT_SOURCE_URL).toBe('https://github.com/florianchrometz/gcportrait');
    expect(DEFAULT_STATIC_DIR.endsWith(path.join('frontend', 'dist'))).toBe(true);
  });

  it('shares the default source URL with the frontend and the e2e expectation', () => {
    // The /api/config contract is declared on both sides (src/schemas.ts, frontend/src/api/config.ts), and so
    // is the footer source link's default: the demo-mode build and live mode's fallback must link where the backend
    // does. Read as text, so no package imports another's source.
    const repository = path.resolve(import.meta.dirname, '../..');
    for (const file of ['frontend/src/source.ts', 'e2e/tests/support.ts']) {
      const text = readFileSync(path.join(repository, file), 'utf8');
      const literal = /export const DEFAULT_SOURCE_URL = '([^']+)';/.exec(text)?.[1];
      expect(literal, `${file} declares DEFAULT_SOURCE_URL`).toBe(DEFAULT_SOURCE_URL);
    }
  });

  it('treats blank values like unset ones', () => {
    const config = parseConfig({
      PORT: '',
      OAUTH_CLIENT_ID: '  ',
      SA_MODE_ENABLED: '',
      SA_MODE_AUDIT_KEY: '  ',
      SA_MODE_CALLERS: '  ',
      BACKEND_SA_EMAIL: '',
      SOURCE_URL: ' ',
    });
    expect(config.port).toBe(8080);
    expect(config.sourceUrl).toBe(DEFAULT_SOURCE_URL);
    expect(config.oauthClientId).toBeNull();
    expect(config.saModeEnabled).toBe(false);
    expect(config.saAuditKey).toBeNull();
    expect(config.saCallers).toEqual([]);
    expect(config.backendServiceAccount).toBeNull();
  });

  it('reads every variable', () => {
    const config = parseConfig(
      {
        PORT: '9090',
        HOST: 'localhost',
        LOG_LEVEL: 'debug',
        LOG_FORMAT: 'pretty',
        OAUTH_CLIENT_ID: '12345678901-abc.apps.googleusercontent.com',
        SA_MODE_ENABLED: 'true',
        SA_MODE_STRICT_EXPOSURE: 'true',
        SA_MODE_AUDIT_KEY: 'test-audit-key',
        SA_MODE_CALLERS: 'alice@example.com, @example.org, corp.example.net',
        BACKEND_SA_EMAIL: 'gcportrait-backend@example.com',
        HOSTED_BY: ' Example Ltd IT ',
        STATIC_DIR: 'public',
        TRUST_PROXY_HOPS: '1',
        APP_VERSION: '1.2.3',
        SOURCE_URL: ' https://git.example.org/team/gcportrait-fork ',
        RENDER_API: 'true',
        RENDER_MAX_ASSETS: '1000',
        RENDER_MAX_PIXELS: '134217728',
        RENDER_TIMEOUT_MS: '840000',
        RENDER_MAX_BODY_BYTES: '1048576',
      },
      '/srv/app',
    );
    expect(config).toEqual({
      port: 9090,
      host: 'localhost',
      logLevel: 'debug',
      logFormat: 'pretty',
      oauthClientId: '12345678901-abc.apps.googleusercontent.com',
      saModeEnabled: true,
      saStrictExposure: true,
      saAuditKey: 'test-audit-key',
      saCallers: ['alice@example.com', '@example.org', 'corp.example.net'],
      backendServiceAccount: 'gcportrait-backend@example.com',
      hostedBy: 'Example Ltd IT',
      staticDir: path.resolve('/srv/app', 'public'),
      trustProxyHops: 1,
      version: '1.2.3',
      sourceUrl: 'https://git.example.org/team/gcportrait-fork',
      demoOnly: false,
      legal: { impressum: null, privacy: null },
      legalUrls: { impressum: null, privacy: null },
      render: { maxAssets: 1000, maxPixels: 134217728, timeoutMs: 840000, maxBodyBytes: 1048576 },
    });
  });

  it('turns the render API off with RENDER_API=false and on a demo-only instance', () => {
    expect(parseConfig({ RENDER_API: 'false' }).render).toBeNull();
    expect(parseConfig({ RENDER_API: '' }).render).not.toBeNull();
    expect(parseConfig({ DEMO_ONLY: 'true' }).render).toBeNull();
    expect(configRefusal({ DEMO_ONLY: 'true', RENDER_API: 'true' })).toMatch(
      /RENDER_API: must not be "true" with DEMO_ONLY=true/,
    );
  });

  // Numbers and switches out of range: the message names the variable and says why, never what was given.
  it.each([
    ['PORT', '0'],
    ['PORT', '65536'],
    ['RENDER_API', 'yes'],
    ['RENDER_MAX_ASSETS', '0'],
    ['RENDER_MAX_ASSETS', '1000001'],
    ['RENDER_MAX_ASSETS', '12.5'],
    ['RENDER_MAX_PIXELS', '999999'],
    ['RENDER_MAX_PIXELS', String(2 ** 27 + 1)],
    ['RENDER_TIMEOUT_MS', '9999'],
    ['RENDER_TIMEOUT_MS', '3600001'],
    ['RENDER_MAX_BODY_BYTES', '1048575'],
    ['RENDER_MAX_BODY_BYTES', String(1024 ** 3 + 1)],
  ])('refuses %s=%j, naming the variable and never the value', (name, value) => {
    const message = configRefusal({ [name]: value });
    expect(message).toContain(`${name}: `);
    expect(message).not.toContain(`: ${value}`);
  });

  it('accepts an http(s) SOURCE_URL and HOSTED_BY as one plain line', () => {
    expect(parseConfig({ SOURCE_URL: 'http://192.0.2.10:3000/gcportrait' }).sourceUrl).toBe(
      'http://192.0.2.10:3000/gcportrait',
    );
    expect(parseConfig({ HOSTED_BY: 'Example Operator' }).hostedBy).toBe('Example Operator');
    expect(parseConfig({ HOSTED_BY: '  ' }).hostedBy).toBeNull();
  });

  // Texts: each refused value carries a marker the message must never repeat (where the value can hold one). A
  // fourth column sets what else the scenario needs.
  it.each<TextRefusal>([
    ['SOURCE_URL', 'javascript:alert(1)//secretvalue', /SOURCE_URL: must be an http:\/\/ or https:\/\/ URL/],
    ['SOURCE_URL', 'ftp://example.com/secretvalue', /SOURCE_URL: must be an http:\/\/ or https:\/\/ URL/],
    ['SOURCE_URL', 'secretvalue', /SOURCE_URL: must be an http:\/\/ or https:\/\/ URL/],
    // Whoever runs an instance is not Google (AGENTS.md, Non-affiliation, brand and legal).
    ['HOSTED_BY', 'Google Cloud secretvalue', /HOSTED_BY: must not name Google/],
    ['HOSTED_BY', 'the googlers secretvalue', /HOSTED_BY: must not name Google/],
    ['HOSTED_BY', 'two\nlines secretvalue', /HOSTED_BY: must be plain text on one line/],
    ['HOSTED_BY', '<b>secretvalue</b>', /HOSTED_BY: must be plain text on one line/],
    ['HOSTED_BY', `${'x'.repeat(81)}secretvalue`, /HOSTED_BY: must be at most 80 characters/],
    ['SA_MODE_AUDIT_KEY', 'two\nlines secretvalue', /SA_MODE_AUDIT_KEY: must not contain control characters/],
    [
      'SA_MODE_CALLERS',
      'not-valid-secretvalue',
      /SA_MODE_CALLERS: must be a comma- or whitespace-separated list/,
    ],
    // A typo must not leave the strict exposure check off where SA mode is on: start-up stops instead.
    ...['TRUE', 'True', '1', 'yes', 'on', ' true', 'true-secretvalue'].map((value): TextRefusal => [
      'SA_MODE_STRICT_EXPOSURE',
      value,
      /SA_MODE_STRICT_EXPOSURE: must be "true" or "false"/,
      { SA_MODE_ENABLED: 'true' },
    ]),
  ])('refuses %s=%j, naming the variable and never the value', (name, value, reason, context = {}) => {
    const message = configRefusal({ ...context, [name]: value });
    expect(message).toMatch(reason);
    expect(message).not.toMatch(/secretvalue/);
  });

  it('enables SA mode only for the exact string "true"', () => {
    expect(parseConfig({ SA_MODE_ENABLED: 'true' }).saModeEnabled).toBe(true);
    for (const value of ['false', 'TRUE', 'True', '1', 'yes', ' true']) {
      expect(parseConfig({ SA_MODE_ENABLED: value }).saModeEnabled).toBe(false);
    }
  });

  it('turns the strict exposure check on for "true", off for "false" or unset (default off)', () => {
    expect(parseConfig({}).saStrictExposure).toBe(false);
    expect(parseConfig({ SA_MODE_STRICT_EXPOSURE: 'true' }).saStrictExposure).toBe(true);
    for (const value of ['false', '', '  ', undefined]) {
      expect(parseConfig({ SA_MODE_STRICT_EXPOSURE: value }).saStrictExposure).toBe(false);
    }
  });

  it('parses and normalizes SA_MODE_CALLERS', () => {
    expect(parseConfig({}).saCallers).toEqual([]);
    expect(
      parseConfig({
        SA_MODE_CALLERS: 'Alice@Example.com,   @Example.ORG   corp.example.net   ',
      }).saCallers,
    ).toEqual(['alice@example.com', '@example.org', 'corp.example.net']);
  });

  it('lists every invalid variable by name without echoing values', () => {
    const message = configRefusal({
      PORT: 'eighty',
      LOG_LEVEL: 'loud',
      BACKEND_SA_EMAIL: 'not-an-email-secretvalue',
    });
    expect(message).toMatch(/PORT/);
    expect(message).toMatch(/LOG_LEVEL/);
    expect(message).toMatch(/BACKEND_SA_EMAIL/);
    expect(message).not.toMatch(/secretvalue/);
  });
});

describe('configWarnings', () => {
  it('is quiet for documented values and for unset or blank ones', () => {
    for (const value of ['true', 'false', '', '  ', undefined]) {
      expect(configWarnings({ SA_MODE_ENABLED: value })).toEqual([]);
    }
    expect(configWarnings({})).toEqual([]);
  });

  it('warns about an SA_MODE_ENABLED value that is probably a typo, without echoing it', () => {
    const warnings = configWarnings({ SA_MODE_ENABLED: 'yes-secretvalue' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/SA_MODE_ENABLED.*stays off/);
    expect(warnings[0]).not.toMatch(/secretvalue/);
  });

  it('leaves SA_MODE_STRICT_EXPOSURE to parseConfig, which refuses an unknown value', () => {
    expect(configWarnings({ SA_MODE_STRICT_EXPOSURE: 'on-secretvalue' })).toEqual([]);
  });
});
