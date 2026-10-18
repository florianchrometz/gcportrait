// SPDX-License-Identifier: MIT
/**
 * The root README's order (AGENTS.md, Documentation): what gcportrait is and does first, then the quick
 * starts, the features with their images, the contributing sections, and the non-affiliation statement and the
 * licence at the bottom. Its wording is free; this test holds the order and the pieces each part must show, the
 * alt text of each generated still and animated demo it shows to the website's (website/src/data/media.json), the
 * alt text of each sample export it shows to that sample's title and summary (scripts/exports.mjs, SAMPLES), and
 * each feature cell's heading and paragraph to the website's copy of it (website/src/data/features.json), which
 * the landing page shows too.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXPORTS_DIR, SAMPLES, expectedFiles } from './exports.mjs';
import { paths, readConfig } from './lib/media-core.mjs';
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

/** An attribute's value as the text it stands for (the character references an attribute may need). */
const attributeText = (value: string): string =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

/** An attribute of one HTML tag, as text; undefined when the tag has none. */
const attribute = (tag: string, name: string): string | undefined => {
  const value = new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
  return value === undefined ? undefined : attributeText(value);
};

/** An image of the README: its `src` and `alt`, and in a `<picture>` the file a dark colour scheme shows. */
type Image = { readonly src: string; readonly alt: string | undefined; readonly dark: string | undefined };

/** Each image of a text, a `<picture>` as one with its `<img>`. */
const images = (text: string): Image[] =>
  [...text.matchAll(/<picture>[\s\S]*?<\/picture>|<img\b[^>]*>/g)].flatMap(([html]) => {
    const img = /<img\b[^>]*>/.exec(html)?.[0];
    const src = img === undefined ? undefined : attribute(img, 'src');
    if (img === undefined || src === undefined) return [];
    const source = /<source\b[^>]*\smedia="\(prefers-color-scheme: dark\)"[^>]*>/.exec(html)?.[0];
    return [
      {
        src,
        alt: attribute(img, 'alt'),
        dark: source === undefined ? undefined : attribute(source, 'srcset'),
      },
    ];
  });

/** The website's alt text of each generated still and animated demo, by the path of each of its files here. */
const WEBSITE_ALTS = (() => {
  const config = readConfig(REPO);
  const alts = new Map<string, string>();
  for (const theme of config.themes) {
    for (const still of config.stills) alts.set(`docs/media/${paths.still(still.id, theme)}`, still.alt);
    for (const scene of config.scenes) alts.set(`docs/media/${paths.gif(scene.id, theme)}`, scene.alt);
  }
  return alts;
})();

/**
 * The alt text of each sample export's files, by the path of each here: the sample's title and summary
 * (scripts/exports.mjs, SAMPLES), as the website's export card shows them above its previews and ends their alt
 * texts with (website/src/components/ExportCard.astro, from the manifest the script writes). A README picture
 * follows the reader's colour scheme, so its alt text names no theme.
 */
const EXPORT_ALTS = new Map<string, string>(
  SAMPLES.flatMap((sample) =>
    expectedFiles([sample]).map(
      (file) => [`${EXPORTS_DIR}/${file}`, `${sample.title}. ${sample.summary}`] as const,
    ),
  ),
);

/**
 * Whether a picture shows its medium in the theme the reader is not using (the dark file by default, the light
 * one for a dark colour scheme): it is about the theme, and its alt text says so in words of its own.
 */
const showsOtherTheme = (image: Image): boolean =>
  /-dark\.\w+$/.test(image.src) && image.dark === image.src.replace(/-dark(\.\w+)$/, '-light$1');

/** A feature's copy: one entry per feature in website/src/data/features.json, the landing page's source too. */
type FeatureCopy = { readonly id: string; readonly title: string; readonly blurb: string };

const FEATURES: readonly FeatureCopy[] = JSON.parse(
  readFileSync(path.join(REPO, 'website/src/data/features.json'), 'utf8'),
) as readonly FeatureCopy[];

/** HTML as a browser reads it: character references resolved, tags dropped, whitespace collapsed. */
const htmlText = (html: string): string =>
  html
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** The features section's cells, each `## h3` heading with the HTML that follows it in its table cell. */
const FEATURE_CELLS = new Map(
  [...section('Features').matchAll(/<h3>([^<]+)<\/h3>([\s\S]*?)(?=<h3>|<\/td>)/g)].map((match) => [
    htmlText(match[1] ?? ''),
    match[2] ?? '',
  ]),
);

/**
 * A feature cell's claim: its first paragraph without the links, which are each page's own (the README's point at
 * files of the repository, the landing page's at its guide pages).
 */
const claim = (cell: string): string =>
  htmlText(
    (/<p>([\s\S]*?)<\/p>/.exec(cell)?.[1] ?? '').replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, ' ').replace(/·/g, ' '),
  );

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

  it('describes each still and animated demo in the website’s words, so neither copy drifts from the other', () => {
    const shown = images(README).filter((image) => WEBSITE_ALTS.has(image.src) && !showsOtherTheme(image));
    expect(shown.length).toBeGreaterThanOrEqual(6);
    const differing = shown
      .filter((image) => image.alt !== WEBSITE_ALTS.get(image.src))
      .map((image) => ({ src: image.src, readme: image.alt, website: WEBSITE_ALTS.get(image.src) }));
    expect(differing).toEqual([]);
  });

  it('gives every feature cell the website’s heading and paragraph, so neither front page copies a blurb of its own', () => {
    // The one source, in the order the two pages show the features: a cell the site has no medium for (asset
    // coverage) is in it too, so no cell is left out of the check.
    expect([...FEATURE_CELLS.keys()]).toEqual(FEATURES.map((feature) => feature.title));
    const differing = FEATURES.filter(
      (feature) => claim(FEATURE_CELLS.get(feature.title) ?? '') !== htmlText(feature.blurb),
    ).map((feature) => ({
      feature: feature.id,
      readme: claim(FEATURE_CELLS.get(feature.title) ?? ''),
      website: htmlText(feature.blurb),
    }));
    expect(differing).toEqual([]);
  });

  it('reads a feature cell’s claim without the links its page puts in it', () => {
    expect(claim('<p>A claim, in words. <a href="docs/export.md">Guide</a></p>')).toBe('A claim, in words.');
    expect(claim('<p>A claim. <a href="a">One</a> · <a href="b">Two</a></p>')).toBe('A claim.');
    expect(claim('<p>Press <code>/</code> to search.</p>')).toBe('Press / to search.');
    expect(claim('')).toBe('');
    expect(htmlText('A&nbsp;claim &amp; more')).toBe('A claim & more');
  });

  it('describes each sample export in its sample’s title and summary, so it says what the website’s card says', () => {
    const shown = images(README).filter(
      (image) => image.src.startsWith(`${EXPORTS_DIR}/`) && !showsOtherTheme(image),
    );
    expect(shown.length).toBeGreaterThanOrEqual(1);
    const differing = shown
      .filter(
        (image) =>
          !EXPORT_ALTS.has(image.src) ||
          image.alt !== EXPORT_ALTS.get(image.src) ||
          (image.dark !== undefined && EXPORT_ALTS.get(image.dark) !== EXPORT_ALTS.get(image.src)),
      )
      .map((image) => ({
        src: image.src,
        dark: image.dark,
        readme: image.alt,
        sample: EXPORT_ALTS.get(image.src) ?? 'not a file of a sample',
      }));
    expect(differing).toEqual([]);
  });

  it('reads the images of its pictures, their dark-scheme files and their alt texts', () => {
    const html = [
      '<p><img src="docs/media/stills/hero-light.png" alt="A &quot;whole&quot; organisation &amp; more"></p>',
      '<picture>',
      '  <source media="(prefers-color-scheme: dark)" srcset="docs/media/stills/hero-light.png">',
      '  <img src="docs/media/stills/hero-dark.png" width="400" alt="The other theme.">',
      '</picture>',
      '<picture>',
      '  <source media="(prefers-color-scheme: dark)" srcset="docs/media/animated/trace-dark.gif">',
      '  <img src="docs/media/animated/trace-light.gif" alt="">',
      '</picture>',
    ].join('\n');
    const found = images(html);
    expect(found).toEqual([
      { src: 'docs/media/stills/hero-light.png', alt: 'A "whole" organisation & more', dark: undefined },
      {
        src: 'docs/media/stills/hero-dark.png',
        alt: 'The other theme.',
        dark: 'docs/media/stills/hero-light.png',
      },
      { src: 'docs/media/animated/trace-light.gif', alt: '', dark: 'docs/media/animated/trace-dark.gif' },
    ]);
    expect(found.map(showsOtherTheme)).toEqual([false, true, false]);
    expect(WEBSITE_ALTS.get('docs/media/animated/trace-dark.gif')).toMatch(/^Animation: /);
    const sharedVpc = SAMPLES.find((sample) => sample.id === 'M-shared-vpc');
    expect(EXPORT_ALTS.get('docs/media/exports/M-shared-vpc-dark-960.webp')).toBe(
      `${sharedVpc?.title ?? ''}. ${sharedVpc?.summary ?? ''}`,
    );
    expect(EXPORT_ALTS.has('docs/media/exports/M-shared-vpc-dark-1200.webp')).toBe(false);
  });

  it('points only at media that exist', () => {
    const media = mediaPaths(README);
    expect(media.length).toBeGreaterThan(0);
    expect(media.filter((file) => !existsSync(path.join(REPO, file)))).toEqual([]);
  });
});
