// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * The top bar's brand mark as its stylesheet sizes it (jsdom lays nothing out; e2e/tests/shell.spec.ts measures it in a
 * browser): a 24-pixel square, centred on the wordmark, with the website header's gap between the mark and the name.
 * And the cap of a sheet over the diagram's canvas: two thirds of the canvas's height (e2e/tests/mobile.spec.ts
 * measures the share of the canvas it leaves in view at every phone size).
 */
import { describe, expect, it } from 'vitest';

import { block, readSource, withoutComments } from '../../test/css';

/** The declarations of the first rule for `selector` in a stylesheet, each as written, without comments. */
function declarations(css: string, selector: string): string[] {
  return block(withoutComments(css), selector)
    .replace('{', '')
    .split(';')
    .map((declaration) => declaration.trim().replace(/\s+/g, ' '))
    .filter((declaration) => declaration !== '');
}

describe('the brand mark in the top bar', () => {
  const css = readSource('shell/topbar/TopBar.module.css');

  it('is a 24-pixel square that keeps its size', () => {
    expect(declarations(css, '.mark {')).toEqual(['flex: none', 'width: 24px', 'height: 24px']);
  });

  it('is centred on the wordmark, with the gap the website header has between its logo and the name', () => {
    expect(declarations(css, '.wordmark {')).toEqual(
      expect.arrayContaining(['display: inline-flex', 'align-items: center', 'gap: 0.6rem']),
    );
    const header = readSource('../../website/src/components/Header.astro');
    expect(declarations(header, '.wordmark {')).toContain('gap: 0.6rem');
  });

  it('colours the "gc" prefix of the wordmark in the primary blue, matching the website header', () => {
    expect(declarations(css, '.wordmarkGc {')).toEqual(['color: var(--color-primary)']);
    const header = readSource('../../website/src/components/Header.astro');
    expect(declarations(header, '.wordmark-gc {')).toEqual(['color: var(--color-primary)']);
  });
});

describe('a sheet over the diagram’s canvas', () => {
  it('is at most two thirds of the canvas’s height, which the bar carries', () => {
    const css = readSource('shell/topbar/TopBar.module.css');
    expect(declarations(css, '.overCanvas .sheet {')).toEqual([
      'max-height: min(40rem, calc(var(--canvas-height) * 2 / 3))',
    ]);
  });
});
