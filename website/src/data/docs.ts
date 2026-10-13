// SPDX-License-Identifier: MIT
/**
 * The docs section of the website: which guides under docs/ are pages, in the order of the docs menu. Each page is
 * rendered from its Markdown file at build time (src/pages/docs/[slug].astro), so the guide in the repository is
 * the one source. `description` is the page's meta description (search results, link previews): one sentence on
 * what the guide covers, kept here so a guide's first paragraph can stay what reads best on GitHub.
 *
 * Every top-level docs/*.md file is either a page here or listed in NOT_ON_SITE with the reason
 * (src/data/docs.test.ts), so a new guide cannot silently miss the site. A page whose file does not exist yet is
 * left out of the build with a warning (and fails a strict build, WEBSITE_STRICT=1).
 */

export type DocPage = {
  /** The URL segment: the page is /docs/<slug>/. */
  readonly slug: string;
  /** The guide, relative to the repository root. */
  readonly source: string;
  /** The page's name in the docs menu. */
  readonly label: string;
  readonly description: string;
  /** The menu group. */
  readonly group: 'Start' | 'Use' | 'Run your own';
};

export const DOC_PAGES: readonly DocPage[] = [
  {
    slug: 'getting-started',
    source: 'docs/getting-started.md',
    label: 'Getting started',
    description:
      'Try gcportrait in two minutes: the sign-in-free demo or a local demo build, what the diagram shows, and where to go next.',
    group: 'Start',
  },
  {
    slug: 'modes',
    source: 'docs/modes.md',
    label: 'Modes',
    description:
      'The ways gcportrait reads Google Cloud: your own account, the instance’s service account, export files, and the synthetic demo.',
    group: 'Start',
  },
  {
    slug: 'permissions',
    source: 'docs/permissions.md',
    label: 'Permissions',
    description:
      'What reading a scope needs: the permission matrix with copy-ready gcloud commands, the quota project, and the service-account grant.',
    group: 'Start',
  },
  {
    slug: 'lenses-and-filters',
    source: 'docs/lenses-and-filters.md',
    label: 'Lenses and filters',
    description:
      'The eleven lenses, focus views, filters, detail levels, drill-in and chips: how to narrow a large organisation to what matters.',
    group: 'Use',
  },
  {
    slug: 'timeline',
    source: 'docs/timeline.md',
    label: 'Timeline',
    description:
      'Move any view through the last 35 days: daily ticks from Cloud Asset Inventory, the diff overlay, extra ticks from exports.',
    group: 'Use',
  },
  {
    slug: 'export',
    source: 'docs/export.md',
    label: 'Export',
    description:
      'Save the current view as SVG, PNG (2× or 3×) or an editable draw.io file, whole diagram or viewport, and what the title block holds.',
    group: 'Use',
  },
  {
    slug: 'faq',
    source: 'docs/faq.md',
    label: 'FAQ',
    description:
      'Answers on missing edges, unknown asset types, the 35-day limit, Shared VPC, the cost of Cloud Asset Inventory calls and privacy.',
    group: 'Use',
  },
  {
    slug: 'self-host',
    source: 'docs/self-host.md',
    label: 'Self-host',
    description:
      'Run gcportrait on Cloud Run in your own Google Cloud project: one installer line with your project id, the OAuth client, one redeploy.',
    group: 'Run your own',
  },
  {
    slug: 'self-host-options',
    source: 'docs/self-host-options.md',
    label: 'Self-host options',
    description:
      'Every optional setting of a self-hosted instance: region, memory, IAP, service-account mode, demo-only, custom domain, legal pages, building from source.',
    group: 'Run your own',
  },
  {
    slug: 'configuration',
    source: 'docs/configuration.md',
    label: 'Configuration',
    description:
      'Every setting of a gcportrait instance: the backend’s environment, the install.sh, deploy.sh and uninstall.sh flags, the image, compose.',
    group: 'Run your own',
  },
  {
    slug: 'api',
    source: 'docs/api.md',
    label: 'API',
    description:
      'An instance’s HTTP API for scripts: SVG, PNG and draw.io renders of a scope, an export or a demo, live pulls, curl examples.',
    group: 'Run your own',
  },
];

/** Top-level docs/*.md files that are not pages of the site, each with the reason. */
export const NOT_ON_SITE: Readonly<Record<string, string>> = {
  'docs/README.md': 'the repository’s index of docs/; the site’s /docs/ page is its counterpart',
  'docs/contributing.md': 'the contributor guide is read next to the code; /contributing/ links to it',
  'docs/packages.md': 'contributor reference (packages and data flow); /contributing/ links to it',
  'docs/catalog-followups.md': 'the asset catalog’s backlog, contributor material',
  'docs/cloudshell-tutorial.md': 'Cloud Shell tutorial markup, opened by the "Open in Cloud Shell" button',
  'docs/author.md': 'rendered as the landing page’s "About the author" section',
  'docs/website.md': 'the maintainer’s guide to building and deploying this site',
  'docs/security.md': 'the security controls and the commands that check them, contributor material',
  'docs/threat-model.md': 'the threat model, contributor material',
  'docs/backlog.md': 'open work, known defects and ideas for later, contributor material',
};

export const DOC_GROUPS = ['Start', 'Use', 'Run your own'] as const;

/** A page of the site that the docs menu and /docs/ list among the guides without being one. */
export type DocMenuExtra = {
  readonly path: string;
  readonly label: string;
  readonly description: string;
  readonly group: DocPage['group'];
  /** The slug of the guide it follows in its group. */
  readonly after: string;
};

export const DOC_MENU_EXTRAS: readonly DocMenuExtra[] = [
  {
    path: '/exports/',
    label: 'Sample exports',
    description:
      'Real SVG, PNG and draw.io exports of the demo organisations in light and dark, to download, open in the browser or in diagrams.net.',
    group: 'Use',
    after: 'export',
  },
];

/** A group's guides with the extra pages after the guides they follow (an extra whose guide is missing goes last). */
export function menuItems<T extends { readonly slug: string }>(
  guides: readonly T[],
  group: DocPage['group'],
): (T | DocMenuExtra)[] {
  const extras = DOC_MENU_EXTRAS.filter((extra) => extra.group === group);
  const items: (T | DocMenuExtra)[] = [];
  for (const guide of guides) {
    items.push(guide);
    items.push(...extras.filter((extra) => extra.after === guide.slug));
  }
  items.push(...extras.filter((extra) => !guides.some((guide) => guide.slug === extra.after)));
  return items;
}

export function docPath(slug: string): string {
  return `/docs/${slug}/`;
}
