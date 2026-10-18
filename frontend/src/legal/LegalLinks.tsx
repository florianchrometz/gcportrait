// SPDX-License-Identifier: Apache-2.0
import { Fragment, type ReactElement } from 'react';
import { Link } from 'react-router';

import { useLegalPages } from '../demoOnly';
import { LEGAL_PAGES, legalTarget, type LegalTarget } from './api';
import { ExternalLegalLink } from './ExternalLegalLink';
import styles from './Legal.module.css';
import { LEGAL_LINK_TEXTS } from './LegalPage';

/**
 * A link to a legal page wherever it is: the instance's own page (/impressum, /privacy) for a text it serves, or the
 * page published elsewhere (LEGAL_IMPRESSUM_URL, LEGAL_PRIVACY_URL; the static demo's maintainer pages), which opens in
 * a new tab so that a signed-in session in this one survives (ExternalLegalLink.tsx).
 */
export function LegalPageLink({
  id,
  target,
  text,
  className,
}: {
  readonly id: 'impressum' | 'privacy';
  readonly target: LegalTarget;
  readonly text: string;
  readonly className?: string | undefined;
}): ReactElement {
  if (target.kind === 'served') {
    return (
      <Link to={`/${id}`} className={className}>
        {text}
      </Link>
    );
  }
  return <ExternalLegalLink url={target.url} host={target.host} text={text} className={className} />;
}

/**
 * The footer's "Impressum · Privacy", on every route next to the non-affiliation notice and the source link: one link
 * per legal page the instance publishes (`legal` in /api/config, or a demo build's built-in configuration,
 * api/demoConfig.ts): its own page for a text it serves, the page elsewhere for one it links (LEGAL_IMPRESSUM_URL,
 * LEGAL_PRIVACY_URL; the static demo's maintainer pages); none at all when it publishes none (a self-hoster without
 * texts, a demo build).
 */
export function LegalLinks({ className }: { readonly className?: string | undefined }): ReactElement | null {
  const published = useLegalPages();
  const pages = LEGAL_PAGES.flatMap((id) => {
    const target = legalTarget(published, id);
    return target === null ? [] : [{ id, target }];
  });
  if (pages.length === 0) return null;
  return (
    <nav aria-label="Legal" className={styles.links}>
      {pages.map(({ id, target }, index) => (
        <Fragment key={id}>
          {index > 0 ? <span aria-hidden="true">·</span> : null}
          <LegalPageLink id={id} target={target} text={LEGAL_LINK_TEXTS[id]} className={className} />
        </Fragment>
      ))}
    </nav>
  );
}
