// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { LegalPagesSchema, LegalTextsSchema, PublicConfigSchema, type PublicConfig } from './api.js';

const CONFIG: PublicConfig = {
  oauthClientId: 'client-1.apps.example.com',
  saMode: true,
  saStrictExposure: false,
  backendServiceAccount: 'gcportrait-backend@demo-host.iam.gserviceaccount.com',
  version: '1.0.0',
  sourceUrl: 'https://example.com/gcportrait',
  hostedBy: 'Hosted by Example.',
  demo: false,
  demoOnly: false,
  legal: { impressum: true, privacy: false, impressumUrl: null, privacyUrl: 'https://example.org/privacy' },
  render: { maxAssets: 50_000, maxPixels: 64_000_000, maxBodyBytes: 52_428_800, timeoutMs: 120_000 },
};

describe('GET /api/config', () => {
  it('accepts what an instance answers, and a demo-only one without OAuth client, account or render API', () => {
    expect(PublicConfigSchema.parse(CONFIG)).toEqual(CONFIG);
    const demoOnly: PublicConfig = {
      ...CONFIG,
      oauthClientId: null,
      saMode: false,
      backendServiceAccount: null,
      hostedBy: null,
      demoOnly: true,
      legal: { impressum: false, privacy: false, impressumUrl: null, privacyUrl: null },
      render: null,
    };
    expect(PublicConfigSchema.parse(demoOnly)).toEqual(demoOnly);
  });

  it.each(['saStrictExposure', 'hostedBy', 'demoOnly', 'legal', 'render', 'sourceUrl'] as const)(
    'requires %s, which every instance sends',
    (field) => {
      const rest = Object.fromEntries(Object.entries(CONFIG).filter(([key]) => key !== field));
      expect(PublicConfigSchema.safeParse(rest).success).toBe(false);
    },
  );

  it('refuses a demo flag that is not false and a render limit that is not an integer', () => {
    expect(PublicConfigSchema.safeParse({ ...CONFIG, demo: true }).success).toBe(false);
    expect(
      PublicConfigSchema.safeParse({ ...CONFIG, render: { ...CONFIG.render, timeoutMs: 1.5 } }).success,
    ).toBe(false);
  });

  it('names both legal pages, each served, linked or neither', () => {
    expect(LegalPagesSchema.safeParse({ impressum: false, privacy: false }).success).toBe(false);
    expect(
      LegalPagesSchema.safeParse({ impressum: false, privacy: false, impressumUrl: 1, privacyUrl: null })
        .success,
    ).toBe(false);
  });
});

describe('GET /api/legal', () => {
  it('holds the Markdown of each page, or null for a page the instance does not serve', () => {
    expect(LegalTextsSchema.parse({ impressum: '# Impressum', privacy: null })).toEqual({
      impressum: '# Impressum',
      privacy: null,
    });
    expect(LegalTextsSchema.safeParse({ impressum: '# Impressum' }).success).toBe(false);
  });
});
