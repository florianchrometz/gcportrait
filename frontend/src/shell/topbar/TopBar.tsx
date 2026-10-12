// SPDX-License-Identifier: MIT
import type { ReactElement } from 'react';
import { Link, NavLink, type To } from 'react-router';

import { UNKNOWN_VERSION } from '../../api/staticConfig';
import { WORDMARK } from '../../branding';
import { cx } from '../../classNames';
import { useDemoOnly } from '../../demoOnly';
import { useAppMode } from '../../mode';
import { useAppState } from '../../state';
import { CopyLinkButton } from '../../views/CopyLink';
import { SavedViewsButton } from '../../views/SavedViewsDialog';
import { useDiagramLinkTarget } from '../viewHash';
import { AccountMenu } from './AccountMenu';
import { Breadcrumb } from './Breadcrumb';
import { DetailControl } from './DetailControl';
import { ExportMenu } from './ExportMenu';
import { FiltersControl } from './FiltersControl';
import { FocusControl } from './FocusControl';
import { LensSelect } from './LensSelect';
import { SearchBox } from './SearchBox';
import { SnapshotMenu } from './SnapshotMenu';
import { ThemeToggle } from './ThemeToggle';
import styles from './TopBar.module.css';

type NavItem = { readonly label: string; readonly to: To; readonly end?: boolean };

function navClassName({ isActive }: { isActive: boolean }): string {
  return cx(styles.navLink, isActive && styles.navLinkActive);
}

/**
 * gcportrait's mark beside the wordmark: brand/icon.svg, the one source of the mark, which every build writes as
 * `favicon.svg` under its base path (frontend/vite.config.ts, `brandFavicon`): `/favicon.svg` on an instance,
 * `/demo/favicon.svg` in the static demo. The file carries both themes' colours itself. Decorative (empty `alt`): the
 * wordmark next to it names the link.
 */
function brandMarkSource(): string {
  return `${import.meta.env.BASE_URL}favicon.svg`;
}

/**
 * The top bar: the brand mark and wordmark, primary navigation, demo badge, the app row's actions (Snapshot menu,
 * Saved views, Copy link, Theme menu, the account once someone signed in with Google, and last, at the bar's right
 * edge, the Export menu, the one filled primary button of the bar) and, on the diagram page only, the view row
 * (breadcrumb, Lens, Focus, Filters, Detail, Search; away from the diagram they could never work, so they are not
 * shown). It only composes them: each control group is its own file in this directory and reads and changes the view
 * through the app store (src/state), never the router or the renderer. A control that cannot act yet (Export while
 * nothing is drawn, Copy link away from the diagram) stays in place, inert (aria-disabled, still focusable). The
 * order below is the tab order and the visual order.
 */
export function TopBar(): ReactElement {
  const { demo } = useAppMode();
  // A demo-only instance is a demo too, for the badge.
  const demoOnly = useDemoOnly();
  const onDiagram = useAppState((state) => state.view.onDiagram);
  // The instance's version, for a draw.io export's `agent` (none in the demo, which has no backend to ask).
  const version = useAppState((state) =>
    state.connect.backend.status === 'ready' && state.connect.backend.config.version !== UNKNOWN_VERSION
      ? state.connect.backend.config.version
      : undefined,
  );
  const diagramTarget = useDiagramLinkTarget();
  const navItems: readonly NavItem[] = [
    { label: 'Connect', to: '/', end: true },
    { label: 'Diagram', to: diagramTarget },
    { label: 'Snapshots', to: '/snapshots' },
    { label: 'Permissions', to: '/permissions' },
    { label: 'Settings', to: '/settings' },
  ];

  return (
    <header className={styles.topBar}>
      <div className={styles.appRow}>
        <Link to="/" className={styles.wordmark}>
          <img src={brandMarkSource()} alt="" className={styles.mark} data-testid="brand-mark" />
          {WORDMARK}
        </Link>
        {demo || demoOnly ? (
          <span className={styles.demoBadge} data-testid="demo-badge">
            Demo mode
          </span>
        ) : null}
        <nav aria-label="Primary" className={styles.nav}>
          <ul className={styles.navList}>
            {navItems.map((item) => (
              <li key={item.label}>
                <NavLink to={item.to} end={item.end ?? false} className={navClassName}>
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.actions}>
          <SnapshotMenu />
          <SavedViewsButton />
          <CopyLinkButton />
          <ThemeToggle />
          <AccountMenu />
          <ExportMenu version={version} />
        </div>
      </div>
      {onDiagram ? (
        <div className={styles.viewRow}>
          <Breadcrumb />
          <LensSelect />
          <FocusControl />
          <FiltersControl />
          <DetailControl />
          <SearchBox />
        </div>
      ) : null}
    </header>
  );
}
