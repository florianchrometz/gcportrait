// SPDX-License-Identifier: MIT

/**
 * Product name, tagline and the non-affiliation statement (ADR 0018 with its placement amendments of 2026-10-11 and
 * 2026-10-12), defined once. Change the wording only together with ADR 0018 and every copy listed below.
 *
 * Where each goes:
 * - `TAGLINE`: the third and last line of the diagram's title block, on the canvas and in every export.
 * - `FOOTER_NOTICE`: the app footer on every route, next to the "Source (MIT)" link, the maintainer's name
 *   a link to `MAINTAINER_URL` (named `MAINTAINER_LINK_LABEL`). The one place in the app that names the maintainer.
 * - `NON_AFFILIATION_LONG`: README, website, docs, the icons README, release notes, the image's description label,
 *   the close of the infra scripts' `--help`, the Connect page's About block.
 *
 * The statement goes in footers and long-form texts only: never in a drawing (no title block, no `<desc>`, on the
 * canvas or in an export), and never with anything that travels with one (a snapshot bundle, the render API's answer,
 * a command line's output, the backend's `hostedBy` line).
 *
 * Copies outside the app are checked against this file by scripts/non-affiliation-copies.test.ts (the image label,
 * the release workflow, the release notes, the third-party notices, infra/common.sh, docs/handoff.md, the Cloud Shell
 * tutorial), website/src/site.test.ts (the website's) and packages/icons/scripts/data.test.ts (the icons README).
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
