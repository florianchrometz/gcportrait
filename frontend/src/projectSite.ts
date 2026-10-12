// SPDX-License-Identifier: MIT

/**
 * The project's website (ADRs 0009 and 0032: `gcportrait.app`, an Astro site on GitHub Pages) and the page
 * of it that the demo-only Connect page sends people to: the self-hosting guide, with its "Open in Cloud
 * Shell" button next to the one-line installer. The website owns the path; change it here
 * together with the website.
 */
export const WEBSITE_URL = 'https://gcportrait.app';
export const SELF_HOST_GUIDE_URL = `${WEBSITE_URL}/docs/self-host/`;
