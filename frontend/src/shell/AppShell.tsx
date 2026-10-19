// SPDX-License-Identifier: Apache-2.0
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { Outlet, useLocation } from '../router';

import { FOOTER_NOTICE_LEAD, MAINTAINER_LINK_LABEL, MAINTAINER_NAME, MAINTAINER_URL } from '../branding';
import { SkipToCanvas } from '../keyboard/SkipToCanvas';
import { LegalLinks } from '../legal/LegalLinks';
import styles from './AppShell.module.css';
import { SourceLink } from './SourceLink';
import { TopBar } from './topbar/TopBar';

/**
 * The frame around every page: skip links (to the content; on the diagram page also straight to the drawing),
 * top bar, the routed page in <main>, and the footer with the non-affiliation notice (`FOOTER_NOTICE`,
 * the maintainer's name a link to their website in a new tab; AGENTS.md, Non-affiliation, brand and legal) and,
 * next to it, the "Source (Apache-2.0)" link, which stay visible on every route and sit
 * outside anything the diagram canvas will ever draw; after them "Impressum · Privacy" when the instance publishes
 * them (legal/LegalLinks.tsx): its own pages, or the pages it links on another site (`legal.impressumUrl` and
 * `legal.privacyUrl` in /api/config or the static demo's configuration), marked as external.
 *
 * A route change ("Try the demo", a top-bar link, Back) moves focus to <main> and announces the new page's title
 * in a polite live region, as a page load would, so keyboard and screen-reader users start on the new page
 * instead of on `<body>` where the control they used went away. A page that has put focus inside <main> itself
 * keeps it; a change of the URL hash alone (a view change on the diagram) is no route change.
 */
export function AppShell() {
  const mainRef = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  const shown = useRef(pathname);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (shown.current === pathname) return;
    const redirectedFromPermissions = shown.current === '/permissions' && pathname === '/';
    shown.current = pathname;
    if (redirectedFromPermissions) return;
    const main = mainRef.current;
    if (main === null) return;
    // The page's own effects ran first (children before parents), so its title is set by now.
    setAnnouncement(main.ownerDocument.title);
    if (!main.contains(main.ownerDocument.activeElement)) main.focus({ preventScroll: true });
  }, [pathname]);

  // A plain #main link would overwrite the URL hash, which belongs to the ViewSpec on /diagram.
  const skipToContent = (event: MouseEvent<HTMLAnchorElement>): void => {
    event.preventDefault();
    mainRef.current?.focus();
  };

  return (
    <div className={styles.shell}>
      <a href="#main" className={styles.skipLink} onClick={skipToContent}>
        Skip to content
      </a>
      <SkipToCanvas className={styles.skipLink} />
      <TopBar />
      <main id="main" ref={mainRef} tabIndex={-1} className={styles.main}>
        <Outlet />
      </main>
      <p role="status" className="visually-hidden" data-testid="route-announcer">
        {announcement}
      </p>
      <footer className={styles.footer}>
        <p>
          {FOOTER_NOTICE_LEAD}
          <a
            href={MAINTAINER_URL}
            target="_blank"
            rel="noopener"
            aria-label={MAINTAINER_LINK_LABEL}
            className={styles.footerLink}
          >
            {MAINTAINER_NAME}
          </a>
        </p>
        <SourceLink className={styles.footerLink} />
        <LegalLinks className={styles.footerLink} />
      </footer>
    </div>
  );
}
