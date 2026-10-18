// SPDX-License-Identifier: Apache-2.0
/**
 * The website's fixed facts: where it and the demo live, the repository, the image, and the non-affiliation
 * wording (AGENTS.md, Modes and hosting, and Non-affiliation, brand and legal).
 *
 * The website may not import the frontend (eslint.config.js, WORKSPACE_DEPENDENCIES), so the non-affiliation strings
 * are copies of frontend/src/branding.ts; src/site.test.ts reads that file as text and fails while they differ.
 */

/** The canonical origin of every page. website/public/CNAME names its host for GitHub Pages. */
export const SITE_URL = 'https://gcportrait.app';
export const SITE_HOST = 'gcportrait.app';

/**
 * The sign-in-free demo: a static build of the app in demo-only mode, served by this site below /demo/
 * (`pnpm demo:static`, which the build runs, astro.config.ts). Every "Try the demo" link points here and opens it in a
 * new tab (src/components/DemoLink.astro): the demo is the app, with no way back to the site. Where an absolute
 * address is needed (the sitemap), `siteUrl(DEMO_URL)` gives https://gcportrait.app/demo/. Only this entry page is
 * listed: the app's other routes (/demo/diagram, …) are states of the same app.
 */
export const DEMO_URL = '/demo/';
/** What a link that opens a new tab adds to its name for assistive technology (visually hidden). */
export const NEW_TAB_NOTE = ' (opens in a new tab)';

/**
 * Whether a link goes to the demo: DEMO_URL or below on this site, written as a path (resolved against `base`, the page
 * it is on) or as an address on SITE_URL's origin.
 */
export function isDemoHref(href: string, base: string = SITE_URL): boolean {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return false;
  }
  return (
    url.origin === new URL(SITE_URL).origin &&
    (url.pathname.startsWith(DEMO_URL) || url.pathname === DEMO_URL.replace(/\/$/, ''))
  );
}

/**
 * The project's repository, as the app's default "Source (Apache-2.0)" link names it (frontend/src/source.ts,
 * DEFAULT_SOURCE_URL); a fork changes it (docs/contributing.md, Releases).
 */
export const REPOSITORY_URL = 'https://github.com/florianchrometz/gcportrait';
/** A repository file or folder on the default branch. */
export function repositoryFileUrl(repoPath: string, kind: 'blob' | 'tree' = 'blob'): string {
  return `${REPOSITORY_URL}/${kind}/main/${repoPath.replace(/^\/+/, '')}`;
}

/** The released container image on GitHub Container Registry, published by the release workflow. */
export const IMAGE = 'ghcr.io/florianchrometz/gcportrait';

/**
 * The one-line installer, infra/install.sh as the site serves it (astro.config.ts), and the quick start it makes: a
 * release's deploy scripts, checked against the release's checksums, run with the project id and nothing else.
 *
 * Its address is written out rather than computed from SITE_URL, as RELEASES_URL's is, and FOOTER_NOTICE_LEAD's
 * computation is marked pure: page scripts import this module, and where several share it the bundler keeps a computed
 * value in their shared file whether it is used or not, which would name addresses in scripts that ask no one
 * (`pnpm website:check` refuses another host named in a script). src/site.test.ts holds each written-out value to what
 * it repeats.
 */
export const INSTALLER_URL = 'https://gcportrait.app/install.sh';
export const INSTALL_COMMAND = `curl -fsSL ${INSTALLER_URL} | bash -s -- --project YOUR_PROJECT`;

/**
 * The "Open in Cloud Shell" link of README.md and docs/self-host.md: the guided tutorial (docs/cloudshell-tutorial.md).
 */
export const CLOUD_SHELL_URL =
  'https://shell.cloud.google.com/cloudshell/editor?cloudshell_git_repo=https://github.com/florianchrometz/gcportrait.git&cloudshell_git_branch=main&cloudshell_workspace=.&cloudshell_tutorial=docs/cloudshell-tutorial.md&show=ide%2Cterminal';
/** The "Run on Google Cloud" link (Google's Cloud Run Button, app.json at the repository root). */
export const CLOUD_RUN_BUTTON_URL =
  'https://deploy.cloud.run/?git_repo=https://github.com/florianchrometz/gcportrait.git&revision=main';

export const PRODUCT_NAME = 'gcportrait';
/** The one-line pitch, as README.md opens. */
export const TAGLINE = 'A portrait of your Google Cloud environment.';

/**
 * The non-affiliation statement's long form (AGENTS.md, Non-affiliation, brand and legal): the README, the website's
 * long-form texts (the landing page's author section, from docs/author.md, the licence page, the guides), the docs, the
 * icons README, the release notes.
 */
export const NON_AFFILIATION_LONG =
  'gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and ' +
  'is not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons ' +
  "are trademarks of Google and are used under Google's icon usage terms.";

/** The maintainer's name as the footer notice spells it; the About section's facts come from docs/author.md. */
export const MAINTAINER_NAME = 'Florian Chrometz';
export const MAINTAINER_URL = 'https://florian-chrometz.de';

/**
 * The footer notice of every page, as the app's footer has it: it ends with the maintainer's name, which the footer
 * renders as a link to MAINTAINER_URL, followed by a full stop. Besides it, only the landing page's author section
 * names the maintainer.
 */
export const FOOTER_NOTICE =
  'Not affiliated with Google / Google Cloud. gcportrait is an independent open-source project by Florian Chrometz';
/** `FOOTER_NOTICE` up to the maintainer's name (the footer's plain text before the link). */
export const FOOTER_NOTICE_LEAD = /* @__PURE__ */ FOOTER_NOTICE.slice(
  0,
  /* @__PURE__ */ FOOTER_NOTICE.lastIndexOf(MAINTAINER_NAME),
);

/**
 * The short line: the footer notice's first sentence, which appears nowhere else (the statement belongs in footers and
 * long-form texts only). No exported file's title block, <title> or <desc> carries it, and the sample exports' check
 * refuses any SVG the site offers that does.
 */
export const EXPORT_DISCLAIMER = 'Not affiliated with Google / Google Cloud.';

/**
 * The Impressum and the privacy notice of the website and the demo: pages of the maintainer's own website, which the
 * footer of every page links (AGENTS.md, Modes and hosting). The site has no legal pages of its own;
 * docs/legal/data-processing-inventory.md lists the facts the privacy notice covers. `pnpm website:check` requires both
 * links on every page.
 */
export const IMPRESSUM_URL = 'https://florian-chrometz.de/legal/impressum';
export const PRIVACY_URL = 'https://florian-chrometz.de/legal/privacy-policy';
/**
 * The footer's legal links, in order: their label, address, and the site they lead to (named for assistive
 * technology). Plain literals, so a page script that imports this module does not carry them (`pnpm website:check`
 * refuses any other host named in a script).
 */
export const LEGAL_LINKS: readonly {
  readonly label: string;
  readonly href: string;
  readonly site: string;
}[] = [
  { label: 'Impressum', href: IMPRESSUM_URL, site: 'florian-chrometz.de' },
  { label: 'Privacy', href: PRIVACY_URL, site: 'florian-chrometz.de' },
];

/**
 * The releases page on GitHub: what changed in each version, as the release workflow writes it from the commits at
 * every tag (scripts/release-notes.mjs). The site keeps no changelog of its own; its "Changelog" links go here.
 * REPOSITORY_URL's /releases, written out (see INSTALLER_URL).
 */
export const RELEASES_URL = 'https://github.com/florianchrometz/gcportrait/releases';

/**
 * The licence of gcportrait's own work (AGENTS.md, Licence and dependencies), as SPDX names it, and its canonical
 * page at the Apache Software Foundation.
 */
export const LICENSE_ID = 'Apache-2.0';
export const LICENSE_URL = 'https://www.apache.org/licenses/LICENSE-2.0';

/** An absolute URL on the site for a path ("/docs/" → "https://gcportrait.app/docs/"). */
export function siteUrl(pathname: string): string {
  return new URL(pathname, SITE_URL).href;
}
