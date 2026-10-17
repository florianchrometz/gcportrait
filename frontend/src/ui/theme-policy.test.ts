// @vitest-environment node
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { readSource, sourceFiles, themeBlock, withoutComments } from '../test/css';

const TOKEN_SHEETS = ['styles/tokens.css', 'diagram/theme/tokens.css'];
const SHEETS = sourceFiles('', (path) => path.endsWith('.css'));
const THEME_ATTRIBUTE = /\[\s*data-theme(?=[\s~|^$*=\]])/gi;

function themeRuleProblems(path: string, source: string): string[] {
  const css = withoutComments(source);
  const problems: string[] = [];
  if (/\bprefers-color-scheme\b/i.test(css)) problems.push('prefers-color-scheme in stylesheet');
  let inspected = 0;
  for (const match of css.matchAll(/([^{}]+)\{/g)) {
    const selector = (match[1] ?? '').trim();
    const attributes = [...selector.matchAll(THEME_ATTRIBUTE)].length;
    if (attributes === 0) continue;
    inspected += attributes;
    if (!TOKEN_SHEETS.includes(path)) problems.push('theme selector outside token sheets');
    const start = match.index + match[0].length;
    const end = css.indexOf('}', start);
    const nested = css.indexOf('{', start);
    if (end < 0 || (nested >= 0 && nested < end)) {
      problems.push('unsupported nested or unclosed theme block');
      continue;
    }
    for (const entry of css.slice(start, end).split(';')) {
      const declaration = entry.trim();
      if (declaration === '') continue;
      const property = /^([\w-]+)\s*:/.exec(declaration)?.[1];
      if (property === undefined) problems.push(`unsupported theme declaration: ${declaration}`);
      else if (!/^--[\w-]+$/.test(property) && property.toLowerCase() !== 'color-scheme')
        problems.push(`non-token theme declaration: ${property}`);
    }
  }
  if (inspected !== [...css.matchAll(THEME_ATTRIBUTE)].length)
    problems.push('unsupported theme selector syntax');
  return problems;
}

describe('theme stylesheet structure', () => {
  it('finds both token sheets and their light and dark blocks', () => {
    expect(SHEETS).toEqual(expect.arrayContaining(TOKEN_SHEETS));
    for (const path of TOKEN_SHEETS)
      for (const theme of ['light', 'dark'] as const)
        expect(themeBlock(readSource(path), theme), `${path}: ${theme}`).not.toBe('');
  });

  it.each(SHEETS)('%s selects themes only through custom properties in token sheets', (path) => {
    expect(themeRuleProblems(path, readSource(path)), path).toEqual([]);
  });
});

describe('the structural guard fixtures', () => {
  it.each([
    [
      'grouped selectors and custom properties',
      ':root, :root[data-theme="light"] { --color-surface: #fff; color-scheme: light; }',
    ],
    [
      'attribute whitespace and a final declaration without a semicolon',
      ':root[ data-theme = dark ] { --color-surface: rgb(1 2 3); color-scheme: dark }',
    ],
    ['paint none', ':root[data-theme=dark] { --dg-zone-region-fill: none; }'],
    ['aliases', ':root[data-theme=dark] { --color-surface: var(--color-primary); }'],
    ['layout declarations outside theme blocks', ':root { --drawer-width: 360px; } .panel { width: 100%; }'],
    ['ordinary responsive rules', '@media (max-width: 79.99rem) { .panel { display: none; } }'],
    [
      'a flat theme block inside a media rule',
      '@media (max-width: 79.99rem) { :root[data-theme=dark] { --color-surface: #fff; } }',
    ],
    [
      'comments containing forbidden examples',
      '/* [data-theme=dark] { width: 1px; } @media (prefers-color-scheme: dark) {} */',
    ],
  ])('accepts %s', (_name, css) => {
    expect(themeRuleProblems('styles/tokens.css', css)).toEqual([]);
  });

  it.each([
    ['width', ':root[data-theme=dark] { width: 12px; }', 'non-token theme declaration: width'],
    [
      'display after a custom property',
      ':root[data-theme=dark] { --color-surface: #fff; display: none }',
      'non-token theme declaration: display',
    ],
    [
      'an ordinary colour declaration',
      ':root[data-theme=dark] { color: #fff; }',
      'non-token theme declaration: color',
    ],
    [
      'a system theme query',
      '@media (prefers-color-scheme: dark) { :root { --color-surface: #000; } }',
      'prefers-color-scheme in stylesheet',
    ],
    [
      'a differently cased system query without a space',
      '@MEDIA(PREFERS-COLOR-SCHEME:dark) { .panel { display: none; } }',
      'prefers-color-scheme in stylesheet',
    ],
    [
      'a nested selector',
      ':root[data-theme=dark] { .panel { width: 12px; } }',
      'unsupported nested or unclosed theme block',
    ],
    [
      'a nested at-rule',
      ':root[data-theme=dark] { @media (max-width: 79.99rem) { --color-surface: #fff; } }',
      'unsupported nested or unclosed theme block',
    ],
    [
      'an unclosed block',
      ':root[data-theme=dark] { --color-surface: #fff;',
      'unsupported nested or unclosed theme block',
    ],
    ['a selector without a block', ':root[data-theme=dark]', 'unsupported theme selector syntax'],
    [
      'an unparsed declaration',
      ':root[data-theme=dark] { width 12px; }',
      'unsupported theme declaration: width 12px',
    ],
  ])('rejects %s', (_name, css, problem) => {
    expect(themeRuleProblems('styles/tokens.css', css)).toContain(problem);
  });

  it.each(['[data-theme=dark]', '[ data-theme = "dark" ]', ':is([data-theme])'])(
    'rejects %s outside the two token sheets',
    (selector) => {
      expect(themeRuleProblems('ui/panel.module.css', `${selector} { --color-surface: #fff; }`)).toContain(
        'theme selector outside token sheets',
      );
    },
  );

  it('checks declaration structure, not custom-property value semantics', () => {
    expect(
      themeRuleProblems('styles/tokens.css', ':root[data-theme=dark] { --size: var(--drawer-width); }'),
    ).toEqual([]);
  });
});
