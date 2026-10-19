// SPDX-License-Identifier: Apache-2.0
/**
 * The generated media the website shows (docs/media/, written by `pnpm media`, scripts/media.mjs): stills as WebP
 * in two widths per theme, the animated demos as WebM with a WebP poster per theme (and the GIF of the same scene,
 * which a browser that cannot play the WebM shows instead), and one 1200×630 link-preview JPEG per page. Vite imports
 * them from docs/media at build time, so each is published once under a hashed name; the PNG stills are for the README
 * and are not published here. Titles and alt texts come from src/data/media.json (the media script's list),
 * dimensions from docs/media/manifest.json.
 *
 * A medium that has not been generated yet is left out with a warning (a strict build fails), so the site still
 * builds on a fresh clone of a branch whose media are being regenerated.
 */
import { readRepoFile, isStrictBuild } from './repo.js';
import mediaList from '../data/media.json' with { type: 'json' };
import { siteUrl } from '../site.js';
import type { SocialImage } from './seo.js';

type Theme = 'light' | 'dark';

const urls: Record<string, string> = {};
const globbed = {
  ...import.meta.glob('../../../docs/media/web/*.webp', { eager: true, query: '?url', import: 'default' }),
  ...import.meta.glob('../../../docs/media/animated/*.{webm,webp,gif}', {
    eager: true,
    query: '?url',
    import: 'default',
  }),
  ...import.meta.glob('../../../docs/media/social/*.jpg', { eager: true, query: '?url', import: 'default' }),
};
for (const [key, url] of Object.entries(globbed)) {
  const at = key.indexOf('docs/media/');
  if (at !== -1 && typeof url === 'string') urls[key.slice(at + 'docs/media/'.length)] = url;
}

type ManifestEntry = { readonly width?: number; readonly height?: number };
let manifestFiles: Readonly<Record<string, ManifestEntry>> | undefined;

function manifestEntry(file: string): ManifestEntry | undefined {
  if (manifestFiles === undefined) {
    const text = readRepoFile('docs/media/manifest.json');
    const parsed: unknown = text === undefined ? {} : JSON.parse(text);
    const files =
      typeof parsed === 'object' &&
      parsed !== null &&
      'files' in parsed &&
      typeof parsed.files === 'object' &&
      parsed.files !== null
        ? (parsed.files as Record<string, ManifestEntry>)
        : {};
    manifestFiles = files;
  }
  return manifestFiles[file];
}

const missing = new Set<string>();

function missingMedium(file: string): void {
  if (!missing.has(file)) {
    missing.add(file);
    const message = `website: docs/media/${file} has not been generated (run \`pnpm media\`)`;
    if (isStrictBuild()) throw new Error(message);
    console.warn(`${message}; it is left out of this build.`);
  }
}

function url(file: string): string | undefined {
  const found = urls[file];
  if (found === undefined) missingMedium(file);
  return found;
}

export type ImageSource = { readonly src: string; readonly srcset: string };
export type ThemedImage = {
  readonly alt: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly light: ImageSource;
  readonly dark: ImageSource;
};

const WEB_WIDTHS: readonly number[] = mediaList.web.widths;

function stillSource(id: string, theme: Theme): ImageSource | undefined {
  const parts: string[] = [];
  let largest: string | undefined;
  for (const width of WEB_WIDTHS) {
    const found = url(`web/${id}-${theme}-${String(width)}.webp`);
    if (found === undefined) return undefined;
    parts.push(`${found} ${String(width)}w`);
    largest ??= found;
  }
  return largest === undefined ? undefined : { src: largest, srcset: parts.join(', ') };
}

/** A still in both themes, or undefined when it has not been generated. */
export function still(id: string): ThemedImage | undefined {
  const spec = mediaList.stills.find((item) => item.id === id);
  if (spec === undefined) throw new Error(`website: no still ${id} in src/data/media.json`);
  const light = stillSource(id, 'light');
  const dark = stillSource(id, 'dark');
  if (light === undefined || dark === undefined) return undefined;
  const entry = manifestEntry(`web/${id}-light-${String(WEB_WIDTHS[0] ?? 0)}.webp`);
  return {
    alt: spec.alt,
    title: spec.title,
    width: entry?.width ?? mediaList.viewport.width,
    height: entry?.height ?? mediaList.viewport.height,
    light,
    dark,
  };
}

type Themed = { readonly light: string; readonly dark: string };
export type ThemedVideo = ThemedImage & { readonly video: Themed; readonly gif: Themed };

/**
 * An animated demo: its poster in both themes, its WebM per theme, and the GIF of the same scene per theme (the
 * fallback where the WebM cannot play; src/components/DemoVideo.astro loads it only then).
 */
export function scene(id: string): ThemedVideo | undefined {
  const spec = mediaList.scenes.find((item) => item.id === id);
  if (spec === undefined) throw new Error(`website: no scene ${id} in src/data/media.json`);
  const posterLight = url(`animated/${id}-light-poster.webp`);
  const posterDark = url(`animated/${id}-dark-poster.webp`);
  const videoLight = url(`animated/${id}-light.webm`);
  const videoDark = url(`animated/${id}-dark.webm`);
  const gifLight = url(`animated/${id}-light.gif`);
  const gifDark = url(`animated/${id}-dark.gif`);
  if (
    posterLight === undefined ||
    posterDark === undefined ||
    videoLight === undefined ||
    videoDark === undefined ||
    gifLight === undefined ||
    gifDark === undefined
  ) {
    return undefined;
  }
  const entry = manifestEntry(`animated/${id}-light-poster.webp`);
  return {
    alt: spec.alt,
    title: spec.title,
    width: entry?.width ?? mediaList.animated.width,
    height:
      entry?.height ??
      Math.round((mediaList.animated.width * mediaList.viewport.height) / mediaList.viewport.width),
    light: { src: posterLight, srcset: '' },
    dark: { src: posterDark, srcset: '' },
    video: { light: videoLight, dark: videoDark },
    gif: { light: gifLight, dark: gifDark },
  };
}

/** The link-preview image of a page (src/data/media.json, `cards`), as an absolute URL. */
export function socialImage(id: string, alt: string): SocialImage | undefined {
  const card = mediaList.cards.find((item) => item.id === id);
  if (card === undefined) throw new Error(`website: no link-preview card ${id} in src/data/media.json`);
  const found = url(`social/${id}.jpg`);
  if (found === undefined) return undefined;
  return { url: siteUrl(found), width: mediaList.social.width, height: mediaList.social.height, alt };
}

/** The ids of the link-preview cards, for the tests. */
export const CARD_IDS: readonly string[] = mediaList.cards.map((card) => card.id);
