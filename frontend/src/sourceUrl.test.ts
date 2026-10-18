// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';

import { readDemoConfig } from './api/demoConfig';
import { readAppMode } from './mode';
import { DEFAULT_SOURCE_URL, isSourceUrl, readSourceUrl } from './source';

describe('isSourceUrl', () => {
  it.each([
    ['https://github.com/florianchrometz/gcportrait', true],
    ['http://192.0.2.10:3000/gcportrait', true],
    ['javascript:alert(1)', false],
    ['data:text/html,<p>x</p>', false],
    ['ftp://example.com/src', false],
    ['/relative/path', false],
    ['', false],
    [undefined, false],
    [42, false],
  ])('%j -> %s', (value, expected) => {
    expect(isSourceUrl(value)).toBe(expected);
  });
});

describe('readSourceUrl (VITE_SOURCE_URL)', () => {
  it('takes an http(s) URL, trimmed', () => {
    expect(readSourceUrl(' https://git.example.org/me/gcportrait ')).toBe(
      'https://git.example.org/me/gcportrait',
    );
  });

  it.each([[undefined], [''], ['  '], ['javascript:alert(1)'], ['not a url']])(
    'falls back to the default for %j',
    (value) => {
      expect(readSourceUrl(value)).toBe(DEFAULT_SOURCE_URL);
    },
  );
});

describe('readAppMode', () => {
  it('reads the build-time source URL and the demo configuration built in', () => {
    expect(readAppMode({})).toEqual({ demoConfig: null, sourceUrl: DEFAULT_SOURCE_URL });
    expect(readAppMode({ VITE_DEMO: '1', VITE_SOURCE_URL: 'https://git.example.org/me/gcportrait' })).toEqual(
      {
        demoConfig: readDemoConfig({
          VITE_DEMO: '1',
          VITE_SOURCE_URL: 'https://git.example.org/me/gcportrait',
        }),
        sourceUrl: 'https://git.example.org/me/gcportrait',
      },
    );
  });
});
