// SPDX-License-Identifier: MIT

/**
 * Product name, tagline and the non-affiliation statement, defined once (AGENTS.md, Non-affiliation, brand and
 * legal). Where each string is shown, and the copies outside the app that are checked against this file:
 * README.md, "Branding and the non-affiliation notice".
 *
 * The statement goes in footers and long-form texts only: never in a drawing (no title block, no `<desc>`, on the
 * canvas or in an export), and never with anything that travels with one (a snapshot bundle, the render API's answer,
 * a command line's output, the backend's `hostedBy` line).
 */

export const WORDMARK = 'gcportrait';

/** The title block's third and last line (canvas and exports alike). */
export const TAGLINE = 'gcportrait.app - Visualize your Google Cloud Infrastructure';

/** The maintainer, whose name the footer links to their personal website. */
export const MAINTAINER_NAME = 'Florian Chrometz';
export const MAINTAINER_URL = 'https://florian-chrometz.de';
/** The accessible name of the footer's link: the visible name first (WCAG 2.5.3), then where it goes. */
export const MAINTAINER_LINK_LABEL = `${MAINTAINER_NAME} (personal website)`;

/** The app footer, every route; it ends with the maintainer's name, which the footer renders as a link. */
export const FOOTER_NOTICE =
  'Not affiliated with Google / Google Cloud. gcportrait is an independent open-source project by Florian Chrometz';

/** `FOOTER_NOTICE` up to the maintainer's name (the footer's plain text before the link). */
export const FOOTER_NOTICE_LEAD = FOOTER_NOTICE.slice(0, FOOTER_NOTICE.lastIndexOf(MAINTAINER_NAME));

/** Long form: README, website, docs, icons README, release notes, image description label, infra `--help`. */
export const NON_AFFILIATION_LONG =
  'gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and ' +
  'is not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons ' +
  "are trademarks of Google and are used under Google's icon usage terms.";
