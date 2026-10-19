// SPDX-License-Identifier: Apache-2.0
/**
 * Search and link-preview metadata of every page: the title, the description, the canonical URL on
 * https://gcportrait.app, OpenGraph and Twitter card tags with the page's 1200×630 social image, and JSON-LD.
 * The structured data names gcportrait's author as a Person; no Organization, and nothing that could read as
 * Google's. The non-affiliation statement is not metadata: it belongs in the footer and the long-form texts
 * (AGENTS.md, Non-affiliation, brand and legal), so no description here carries it.
 */
import { LICENSE_URL, PRODUCT_NAME, REPOSITORY_URL, SITE_URL, TAGLINE, siteUrl } from '../site.js';

export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonLd = { readonly [key: string]: JsonValue };

export type SocialImage = {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
};

export type PageMeta = {
  /** The page's own title; the document title adds the product name (fullTitle). */
  readonly title: string;
  readonly description: string;
  /** The page's path with its trailing slash ("/docs/self-host/"). */
  readonly path: string;
  readonly socialImage?: SocialImage | undefined;
  readonly type?: 'website' | 'article';
  readonly jsonLd?: readonly JsonLd[];
  /** Keep the page out of search results, with no canonical URL (the 404 page, served at every unknown address). */
  readonly noindex?: boolean;
};

/** The document title: the landing page leads with the product, every other page with its own title. */
export function fullTitle(meta: Pick<PageMeta, 'title' | 'path'>): string {
  return meta.path === '/' ? `${PRODUCT_NAME}: ${meta.title}` : `${meta.title} · ${PRODUCT_NAME}`;
}

export function canonicalUrl(pathname: string): string {
  return siteUrl(pathname);
}

/** A JSON-LD block's text, safe inside <script>: no "</script" and no HTML comment can appear in it. */
export function jsonLdText(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export type Author = {
  readonly name: string;
  readonly url: string;
  readonly sameAs: readonly string[];
  readonly jobTitle?: string | undefined;
  readonly description?: string | undefined;
  readonly image?: string | undefined;
};

export function personLd(author: Author): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    '@id': `${SITE_URL}/#author`,
    name: author.name,
    url: author.url,
    ...(author.sameAs.length === 0 ? {} : { sameAs: [...author.sameAs] }),
    ...(author.jobTitle === undefined ? {} : { jobTitle: author.jobTitle }),
    ...(author.description === undefined ? {} : { description: author.description }),
    ...(author.image === undefined ? {} : { image: author.image }),
  };
}

/**
 * The three ways to use gcportrait, as the landing page presents them (src/pages/index.astro) and README.md's lead
 * says them: the SoftwareApplication's featureList.
 */
export const FEATURE_LIST = [
  'Self-hosted: one Cloud Run service in your own Google Cloud project, deployed by one script, with no database and no stored token',
  'Web app: Google Cloud-style architecture diagrams of an organisation, folder or project from Cloud Asset Inventory, with lenses, search, a details drawer, a 35-day timeline and SVG, PNG or draw.io export',
  'API: POST /api/render returns any view of a live scope, an export file, a snapshot or a demo organisation as SVG, PNG or draw.io, without the web app',
] as const;

/**
 * The landing page's SoftwareApplication: free, Apache-2.0, its source on GitHub, its author a Person. Its
 * description says what gcportrait does, the three ways, and nothing else.
 */
export function softwareApplicationLd(options: {
  readonly author: Author | undefined;
  readonly screenshot?: string;
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#software`,
    name: PRODUCT_NAME,
    alternateName: TAGLINE,
    description:
      'gcportrait creates a Google Cloud architecture diagram from Cloud Asset Inventory data to render the actual state ' +
      'of a Google Cloud organisation, folder or project, three ways: self-hosted, as one Cloud Run service in your ' +
      'own Google Cloud project; as a web app with lenses, search, a 35-day timeline, SVG, PNG and draw.io export, ' +
      'light and dark themes and a demo mode; and through an API that returns any view as SVG, PNG or draw.io ' +
      'without the web app.',
    featureList: [...FEATURE_LIST],
    url: `${SITE_URL}/`,
    applicationCategory: 'DeveloperApplication',
    applicationSubCategory: 'Google Cloud architecture diagrams',
    operatingSystem: 'Any (web browser); self-hosted on Google Cloud Run',
    license: LICENSE_URL,
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    sameAs: [REPOSITORY_URL],
    softwareHelp: siteUrl('/docs/'),
    ...(options.screenshot === undefined ? {} : { screenshot: options.screenshot }),
    ...(options.author === undefined
      ? {}
      : { author: { '@id': `${SITE_URL}/#author` }, creator: { '@id': `${SITE_URL}/#author` } }),
  };
}

/** The source code: where it lives, its language and licence. */
export function sourceCodeLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: `${PRODUCT_NAME} source code`,
    codeRepository: REPOSITORY_URL,
    programmingLanguage: 'TypeScript',
    license: LICENSE_URL,
    targetProduct: { '@id': `${SITE_URL}/#software` },
  };
}

export function websiteLd(): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: PRODUCT_NAME,
    url: `${SITE_URL}/`,
    inLanguage: 'en',
  };
}

export function breadcrumbLd(trail: readonly { readonly name: string; readonly path: string }[]): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: siteUrl(item.path),
    })),
  };
}

/**
 * A guide's TechArticle. Its author is the Person of the landing page's author section, given by its id and website
 * without the name: the site names the maintainer in the author section and the footer notice only (AGENTS.md,
 * Non-affiliation, brand and legal).
 */
export function articleLd(options: {
  readonly title: string;
  readonly description: string;
  readonly path: string;
  readonly author: Author | undefined;
}): JsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: options.title,
    description: options.description,
    url: siteUrl(options.path),
    inLanguage: 'en',
    about: { '@id': `${SITE_URL}/#software` },
    ...(options.author === undefined
      ? {}
      : {
          author: {
            '@type': 'Person',
            '@id': `${SITE_URL}/#author`,
            name: options.author.name,
            url: options.author.url,
          },
        }),
  };
}
