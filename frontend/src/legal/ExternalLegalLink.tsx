// SPDX-License-Identifier: MIT
import type { ReactElement } from 'react';

import styles from './Legal.module.css';

/**
 * The accessible name of a link to a legal page on another site: the visible text first (WCAG 2.5.3), then that it
 * opens that site in a new tab ("Impressum (opens operator.example.com in a new tab)").
 */
export function externalLegalLinkName(text: string, host: string): string {
  return `${text} (opens ${host} in a new tab)`;
}

/**
 * A link to a legal page published on another site (LEGAL_IMPRESSUM_URL, LEGAL_PRIVACY_URL; the static demo's
 * maintainer pages). It opens in a new tab (`target="_blank"`, `rel="noopener"`): the sign-in lives in this tab's
 * memory only, so following the link in the same tab would end a signed-in session (the website keeps its own legal
 * links in the same tab; it has no session). It is marked twice: an arrow after the text for the eye (hidden from
 * assistive technology) and its accessible name ({@link externalLegalLinkName}) for everyone else.
 */
export function ExternalLegalLink({
  url,
  host,
  text,
  className,
}: {
  readonly url: string;
  readonly host: string;
  readonly text: string;
  readonly className?: string | undefined;
}): ReactElement {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener"
      aria-label={externalLegalLinkName(text, host)}
      className={className}
    >
      {text}
      <svg className={styles.externalMark} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path
          d="M6 3h7v7M13 3 4 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </a>
  );
}
