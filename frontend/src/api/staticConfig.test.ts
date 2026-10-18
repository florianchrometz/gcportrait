// @vitest-environment node
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { readAppMode } from '../mode';
import { DEFAULT_SOURCE_URL } from '../source';
import { isLegalUrl, isPublicConfig } from './config';
import { readStaticConfig, UNKNOWN_VERSION } from './staticConfig';

const IMPRESSUM = 'https://operator.example.com/legal/impressum';
const PRIVACY = 'https://operator.example.com/legal/privacy';

describe('readStaticConfig (the static demo)', () => {
  it('is null for every build but the static demo', () => {
    expect(readStaticConfig({})).toBeNull();
    expect(readStaticConfig({ VITE_STATIC_DEMO: '0', VITE_APP_VERSION: '1.0.0' })).toBeNull();
    expect(readAppMode({}).staticConfig).toBeUndefined();
  });

  it('is what a demo-only instance answers: no sign-in, no service account, the legal pages linked', () => {
    const config = readStaticConfig({
      VITE_STATIC_DEMO: '1',
      VITE_APP_VERSION: ' 1.2.0-3-gabc1234 ',
      VITE_SOURCE_URL: 'https://git.example.org/me/gcportrait',
      VITE_LEGAL_IMPRESSUM_URL: IMPRESSUM,
      VITE_LEGAL_PRIVACY_URL: ` ${PRIVACY} `,
    });
    expect(config).toEqual({
      oauthClientId: null,
      saMode: false,
      saStrictExposure: false,
      backendServiceAccount: null,
      version: '1.2.0-3-gabc1234',
      sourceUrl: 'https://git.example.org/me/gcportrait',
      hostedBy: null,
      demo: false,
      demoOnly: true,
      legal: { impressum: false, privacy: false, impressumUrl: IMPRESSUM, privacyUrl: PRIVACY },
      render: null,
    });
    expect(isPublicConfig(config)).toBe(true);
    expect(readAppMode({ VITE_STATIC_DEMO: '1' })).toEqual({
      demo: false,
      sourceUrl: DEFAULT_SOURCE_URL,
      staticConfig: readStaticConfig({ VITE_STATIC_DEMO: '1' }),
    });
  });

  it('links no legal page for a missing or unusable address, and names an unknown version', () => {
    for (const value of [
      undefined,
      '',
      'http://operator.example.com/x',
      'javascript:alert(1)',
      'https://me:pw@x.example.com/',
    ]) {
      const config = readStaticConfig({
        VITE_STATIC_DEMO: '1',
        VITE_LEGAL_IMPRESSUM_URL: value,
        VITE_LEGAL_PRIVACY_URL: value,
      });
      expect(config?.legal).toEqual({
        impressum: false,
        privacy: false,
        impressumUrl: null,
        privacyUrl: null,
      });
      expect(config?.version).toBe(UNKNOWN_VERSION);
      expect(config?.sourceUrl).toBe(DEFAULT_SOURCE_URL);
    }
  });

  it('refuses the build-time demo mode next to it', () => {
    expect(() => readAppMode({ VITE_DEMO: '1', VITE_STATIC_DEMO: '1' })).toThrow(/exclude each other/);
  });
});

describe('the legal pages in /api/config', () => {
  it('takes only an https address with a host and no credentials as a page to link', () => {
    expect(isLegalUrl(IMPRESSUM)).toBe(true);
    for (const value of [
      null,
      1,
      '',
      '/impressum',
      'http://x.example.com/',
      'mailto:a@example.com',
      'https://u:p@x.example.com/',
    ])
      expect(isLegalUrl(value)).toBe(false);
  });
});
