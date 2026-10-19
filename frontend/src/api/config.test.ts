// SPDX-License-Identifier: Apache-2.0
/**
 * GET /api/config's guard (api/config.ts) against the contract it checks by hand, `PublicConfigSchema` in
 * @gcportrait/model, which the backend answers with: every answer one accepts the other does too. zod is loaded
 * here only, in the test; the guard itself stays zod-free for the UI thread.
 */
import { LegalTextsSchema, PublicConfigSchema } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { publicConfig, staticDemoConfig } from '../test/backend';
import { isLegalTexts } from '../legal/api';
import { isPublicConfig } from './config';

const LIVE = publicConfig({
  oauthClientId: 'client-1.apps.example.com',
  saMode: true,
  saStrictExposure: true,
  backendServiceAccount: 'gcportrait-backend@demo-host.iam.gserviceaccount.com',
  hostedBy: 'Hosted by Example Ltd.',
  legal: { impressum: true, privacy: false, impressumUrl: null, privacyUrl: 'https://example.org/privacy' },
  render: { maxAssets: 50_000, maxPixels: 64_000_000, maxBodyBytes: 52_428_800, timeoutMs: 120_000 },
});

function without(field: keyof typeof LIVE): Record<string, unknown> {
  return Object.fromEntries(Object.entries(LIVE).filter(([key]) => key !== field));
}

const ANSWERS: ReadonlyArray<readonly [string, unknown]> = [
  ['a live instance', LIVE],
  ['a demo-only instance', publicConfig({ demoOnly: true })],
  ['the static demo’s built-in configuration', staticDemoConfig()],
  ...(Object.keys(LIVE) as Array<keyof typeof LIVE>).map(
    (field) => [`an answer without ${field}`, without(field)] as const,
  ),
  ['the build-time demo flag', { ...LIVE, demo: true }],
  ['a legal page’s address that is not a string', { ...LIVE, legal: { ...LIVE.legal, impressumUrl: 1 } }],
  ['legal pages without their addresses', { ...LIVE, legal: { impressum: true, privacy: true } }],
  ['a render limit that is not an integer', { ...LIVE, render: { ...LIVE.render, timeoutMs: 1.5 } }],
  ['a render limit missing', { ...LIVE, render: { maxAssets: 1, maxPixels: 1, maxBodyBytes: 1 } }],
  ['a hosting line that is not a string', { ...LIVE, hostedBy: 1 }],
  ['an array', [LIVE]],
  ['null', null],
];

describe('the configuration guard', () => {
  it.each(ANSWERS)('agrees with the model’s schema on %s', (_case, answer) => {
    expect(isPublicConfig(answer)).toBe(PublicConfigSchema.safeParse(answer).success);
  });

  it('accepts what instances answer and refuses an answer missing a field', () => {
    expect(isPublicConfig(LIVE)).toBe(true);
    expect(isPublicConfig(staticDemoConfig())).toBe(true);
    expect(isPublicConfig(without('render'))).toBe(false);
  });
});

describe('the legal texts guard (GET /api/legal)', () => {
  it.each<[string, unknown]>([
    ['both texts', { impressum: '# Impressum', privacy: 'Nothing is stored.' }],
    ['one page not served', { impressum: '# Impressum', privacy: null }],
    ['a page missing', { impressum: '# Impressum' }],
    ['a text that is not a string', { impressum: 1, privacy: null }],
    ['an array', ['# Impressum', null]],
    ['null', null],
  ])('agrees with the model’s schema on %s', (_case, answer) => {
    expect(isLegalTexts(answer)).toBe(LegalTextsSchema.safeParse(answer).success);
  });
});
