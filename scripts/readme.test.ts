// SPDX-License-Identifier: MIT
/**
 * The root README's order (AGENTS.md, Documentation): what gcportrait is and does first, then the quick
 * starts, the features with their images, the contributing sections, and the non-affiliation statement and the
 * licence at the bottom. Its wording is free; this test holds the order and the pieces each part must show.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { REPO } from './testing/temp-tree.js';

const README = readFileSync(path.join(REPO, 'README.md'), 'utf8');

/** The text before the first `## ` heading, and each `## ` section by its heading. */
const [INTRO = '', ...SECTION_TEXTS] = README.split(/^## /m);
const SECTIONS = new Map(
  SECTION_TEXTS.map((text) => {
    const newline = text.indexOf('\n');
    return [text.slice(0, newline).trim(), text.slice(newline + 1)] as const;
  }),
);
const section = (heading: string): string => SECTIONS.get(heading) ?? '';

/** The order of the `## ` sections. */
const ORDER = [
  'Quick start',
  'Features',
  'How it works',
  'Tech stack',
  'Roadmap',
  'Contributing',
  'Learn more',
  'Author',
  'Not affiliated with Google',
  'Licence',
];

/** The positions of `needles` in `text`, in the order given; -1 for one that is missing. */
const positions = (text: string, needles: readonly string[]): number[] =>
  needles.map((needle) => text.indexOf(needle));

/** Every `src` and `srcset` that points into docs/media/. */
const mediaPaths = (text: string): string[] =>
  [...text.matchAll(/\b(?:src|srcset)="(docs\/media\/[^"]+)"/g)].map((match) => match[1] ?? '');

describe('the README', () => {
  it('keeps its sections in order, the statement and the licence last', () => {
    expect([...SECTIONS.keys()]).toEqual(ORDER);
  });

  it('opens with what gcportrait is and does, and the hero animation in both themes', () => {
    expect(INTRO).toContain('docs/media/brand/wordmark-light.svg');
    expect(INTRO).toMatch(/^gcportrait draws /m);
    expect(INTRO).toMatch(/srcset="docs\/media\/animated\/[\w-]+-dark\.gif"/);
    expect(INTRO).toMatch(/src="docs\/media\/animated\/[\w-]+-light\.gif"/);
  });

  it('starts with the installer, then Cloud Shell, the Run on Google Cloud button and the demo', () => {
    const quickStart = section('Quick start');
    const found = positions(quickStart, [
      '### Self-host in 10 minutes',
      'curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project YOUR_PROJECT',
      '[![Open in Cloud Shell]',
      '[![Run on Google Cloud]',
      '### Try the demo',
    ]);
    expect(found.every((position) => position >= 0)).toBe(true);
    expect(found).toEqual([...found].sort((a, b) => a - b));
  });

  it('shows the features with stills and animated demos in both themes', () => {
    const features = section('Features');
    const media = mediaPaths(features);
    expect(media.filter((file) => file.endsWith('.gif')).length).toBeGreaterThanOrEqual(3);
    expect(media.filter((file) => /\.(?:png|webp)$/.test(file)).length).toBeGreaterThanOrEqual(3);
    expect(media.some((file) => file.includes('-dark'))).toBe(true);
  });

  it('points only at media that exist', () => {
    const media = mediaPaths(README);
    expect(media.length).toBeGreaterThan(0);
    expect(media.filter((file) => !existsSync(path.join(REPO, file)))).toEqual([]);
  });
});
