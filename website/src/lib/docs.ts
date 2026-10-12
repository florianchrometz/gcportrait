// SPDX-License-Identifier: MIT
/**
 * The docs pages, rendered from docs/ at build time (src/data/docs.ts lists them). A guide whose file does not
 * exist is left out with a warning, or fails a strict build. Their commands are fillable (src/lib/fillable.ts): the
 * variables in their code become fields, and a token the registry does not list is reported here and fails
 * `pnpm website:check`.
 */
import { DOC_PAGES, docPath, type DocPage } from '../data/docs.js';
import { excerpt, renderMarkdown, type Heading } from './markdown.js';
import { isRepoDirectory, isStrictBuild, readRepoFile } from './repo.js';

export type RenderedDoc = DocPage & {
  readonly path: string;
  readonly title: string;
  readonly html: string;
  readonly headings: readonly Heading[];
  readonly description: string;
  /** The variables of the guide's fields, in the order they first appear (the Variables panel lists them). */
  readonly variables: readonly string[];
  /** The guide's code blocks; the page's script is included when there is one. */
  readonly codeBlocks: number;
};

/** Every page of the site that is rendered from a repository file: repository path → site path. */
export function sitePagesBySource(): Map<string, string> {
  const pages = new Map<string, string>();
  for (const page of DOC_PAGES) {
    if (readRepoFile(page.source) !== undefined) pages.set(page.source, docPath(page.slug));
  }
  return pages;
}

let cached: RenderedDoc[] | undefined;

/**
 * The docs that exist, rendered once per build and cached. A repository image in a guide becomes its alt text linked
 * to the file on GitHub (renderMarkdown without `resolveImage`; no guide shows one yet).
 */
export function renderedDocs(): RenderedDoc[] {
  if (cached !== undefined) return cached;
  const pages = sitePagesBySource();
  const missing: string[] = [];
  const docs: RenderedDoc[] = [];
  for (const page of DOC_PAGES) {
    const source = readRepoFile(page.source);
    if (source === undefined) {
      missing.push(page.source);
      continue;
    }
    const rendered = renderMarkdown(source, {
      sourcePath: page.source,
      pages,
      isDirectory: isRepoDirectory,
      dropTitle: true,
      fillable: true,
    });
    if (rendered.unknownTokens.length > 0) {
      console.warn(
        `website: ${page.source} names ${rendered.unknownTokens.join(', ')} in its code, which COMMAND_VARIABLES (@gcportrait/model) does not list; they stay text.`,
      );
    }
    docs.push({
      ...page,
      path: docPath(page.slug),
      title: rendered.title ?? page.label,
      html: rendered.html,
      headings: rendered.headings,
      description: page.description === '' ? excerpt(rendered.lead ?? page.label) : page.description,
      variables: rendered.variables,
      codeBlocks: rendered.codeBlocks,
    });
  }
  if (missing.length > 0) {
    const message = `website: the docs manifest names guides that do not exist: ${missing.join(', ')}`;
    if (isStrictBuild()) throw new Error(`${message} (a strict build needs every guide; src/data/docs.ts)`);
    console.warn(`${message}; their pages are left out of this build.`);
  }
  cached = docs;
  return docs;
}
