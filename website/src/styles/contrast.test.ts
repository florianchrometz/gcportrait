// SPDX-License-Identifier: MIT
/**
 * WCAG 2.2 AA for the website's colours (AGENTS.md, Style and accessibility): every text colour on every background
 * it is used on reaches 4.5 : 1, and the focus ring 3 : 1, in the light and the dark theme, read from global.css
 * itself.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const CSS = readFileSync(path.join(import.meta.dirname, 'global.css'), 'utf8');

function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--(color-[a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((match) => [
      match[1] ?? '',
      (match[2] ?? '').toLowerCase(),
    ]),
  );
}

const light = tokens(/:root \{([\s\S]*?)\n\}/.exec(CSS)?.[1] ?? '');
const dark = {
  ...light,
  ...tokens(/@media \(prefers-color-scheme: dark\) \{\s*:root \{([\s\S]*?)\n {2}\}/.exec(CSS)?.[1] ?? ''),
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => {
    const value = parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** Text colour on background, as the styles use them. */
const TEXT_PAIRS: readonly [string, string][] = [
  ['color-text', 'color-bg'],
  ['color-text', 'color-bg-alt'],
  ['color-text', 'color-code-bg'],
  ['color-text-muted', 'color-bg'],
  ['color-text-muted', 'color-bg-alt'],
  ['color-text-muted', 'color-code-bg'],
  ['color-link', 'color-bg'],
  ['color-link', 'color-bg-alt'],
  ['color-on-primary', 'color-primary'],
  ['color-text', 'color-tint-project'],
  ['color-text', 'color-tint-vpc'],
  ['color-text', 'color-tint-subnet'],
  ['color-text', 'color-tint-folder'],
  // Fillable commands: a variable's field, unfilled and filled; a format hint in the panel and in a code block's bar.
  ['color-text', 'color-var-bg'],
  ['color-text', 'color-var-filled-bg'],
  ['color-error', 'color-bg'],
  ['color-error', 'color-bg-alt'],
  ['color-error', 'color-code-bg'],
];

/** The edges of controls and marks on their background, at 3 : 1 (WCAG 1.4.11). */
const UI_PAIRS: readonly [string, string][] = [
  ['color-border-strong', 'color-bg'],
  ['color-var-line', 'color-var-bg'],
  ['color-error', 'color-var-bg'],
  ['color-error', 'color-var-filled-bg'],
  // A field's edit mark (the pencil) on both tints, and its hover ring on the backgrounds code sits on.
  ['color-var-line', 'color-var-filled-bg'],
  ['color-var-line', 'color-code-bg'],
  ['color-var-line', 'color-bg'],
  ['color-var-line', 'color-bg-alt'],
];

describe.each([
  ['light', light],
  ['dark', dark],
])('the %s theme', (_, palette) => {
  it('defines every colour', () => {
    for (const [text, background] of TEXT_PAIRS) {
      expect(palette[text], text).toMatch(/^#[0-9a-f]{6}$/);
      expect(palette[background], background).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it.each(TEXT_PAIRS)('%s on %s reaches 4.5 : 1', (text, background) => {
    expect(contrast(palette[text] ?? '', palette[background] ?? '')).toBeGreaterThanOrEqual(4.5);
  });

  it.each(UI_PAIRS)('%s on %s reaches 3 : 1', (mark, background) => {
    expect(contrast(palette[mark] ?? '', palette[background] ?? '')).toBeGreaterThanOrEqual(3);
  });

  it('draws the focus ring at 3 : 1 against both backgrounds', () => {
    expect(contrast(palette['color-focus'] ?? '', palette['color-bg'] ?? '')).toBeGreaterThanOrEqual(3);
    expect(contrast(palette['color-focus'] ?? '', palette['color-bg-alt'] ?? '')).toBeGreaterThanOrEqual(3);
  });
});

it('takes the dark theme from prefers-color-scheme and changes every background', () => {
  expect(dark['color-bg']).toBe('#1f1f1f');
  expect(light['color-bg']).toBe('#ffffff');
  for (const name of ['color-bg-alt', 'color-code-bg', 'color-text']) {
    expect(dark[name], name).not.toBe(light[name]);
  }
});
