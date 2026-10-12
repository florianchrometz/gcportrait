// SPDX-License-Identifier: MIT
/**
 * The landing page's "About the author" section and its Person structured data, from docs/author.md: YAML front
 * matter for the facts, Markdown for the biography.
 *
 * ```markdown
 * ---
 * name: Florian Chrometz              # required
 * url: https://florian-chrometz.de    # required: the personal website
 * jobTitle: …                         # optional
 * sameAs:                             # optional: profile pages (https only; anything else is left out)
 *   - https://github.com/florianchrometz
 * image: docs/media/author/portrait.webp   # optional: a repository image the site carries
 * ---
 * <!-- SPDX-License-Identifier: MIT -->
 *
 * # About the author
 *
 * One or two paragraphs.
 * ```
 *
 * A missing file leaves the section out (a strict build fails); a placeholder fails a strict build.
 */
import { parse } from 'yaml';

import { excerpt, renderMarkdown } from './markdown.js';
import { placeholdersIn } from './placeholders.js';
import { isStrictBuild, readRepoFile } from './repo.js';
import type { Author } from './seo.js';

export const AUTHOR_SOURCE = 'docs/author.md';

export type AuthorSection = Author & {
  readonly heading: string;
  readonly html: string;
  /** The image's repository path, when docs/author.md names one. */
  readonly imagePath?: string | undefined;
  readonly placeholders: readonly string[];
};

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

/** Parses docs/author.md's text (exported for the tests). */
export function parseAuthor(text: string): AuthorSection {
  const match = FRONT_MATTER.exec(text);
  const raw: unknown = match === null ? {} : parse(match[1] ?? '');
  const data: Record<string, unknown> =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? { ...raw } : {};
  const body = match === null ? text : text.slice(match[0].length);
  const name = stringField(data, 'name');
  const url = stringField(data, 'url');
  if (name === undefined || url === undefined || !isHttpsUrl(url)) {
    throw new Error(`${AUTHOR_SOURCE}: the front matter needs a name and an https url`);
  }
  const sameAsRaw = data.sameAs;
  const sameAs = (Array.isArray(sameAsRaw) ? sameAsRaw : [])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(isHttpsUrl);
  const rendered = renderMarkdown(body, { sourcePath: AUTHOR_SOURCE, dropTitle: true });
  return {
    name,
    url,
    sameAs,
    jobTitle: stringField(data, 'jobTitle'),
    imagePath: stringField(data, 'image'),
    description: rendered.lead === undefined ? undefined : excerpt(rendered.lead, 300),
    heading: rendered.title ?? 'About the author',
    html: rendered.html,
    placeholders: placeholdersIn(text),
  };
}

let cached: AuthorSection | null | undefined;

/** docs/author.md, parsed; null when the file does not exist (outside a strict build). */
export function authorSection(): AuthorSection | null {
  if (cached !== undefined) return cached;
  const text = readRepoFile(AUTHOR_SOURCE);
  if (text === undefined) {
    if (isStrictBuild())
      throw new Error(`website: ${AUTHOR_SOURCE} is missing; the landing page presents the author from it`);
    console.warn(`website: ${AUTHOR_SOURCE} is missing; the "About the author" section is left out.`);
    cached = null;
    return null;
  }
  const author = parseAuthor(text);
  if (author.placeholders.length > 0) {
    const message = `website: ${AUTHOR_SOURCE} still holds placeholders: ${author.placeholders.join(', ')}`;
    if (isStrictBuild()) throw new Error(message);
    console.warn(message);
  }
  cached = author;
  return author;
}
