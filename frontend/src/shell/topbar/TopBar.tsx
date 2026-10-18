// SPDX-License-Identifier: Apache-2.0
import { useEffect, type CSSProperties, type ReactElement } from 'react';
import { Link, NavLink, useLocation, type To } from 'react-router';

import { UNKNOWN_VERSION } from '../../api/demoConfig';
import { WORDMARK } from '../../branding';
import { cx } from '../../classNames';
import { useDemoOnly } from '../../demoOnly';
import { useAppState, useAppStore, useSheet } from '../../state';
import { Popover } from '../../ui/Popover';
import { useScreen } from '../../ui/screen';
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
import { MORE_SHEET, VIEW_SHEET } from './sheets';
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
 *
 * Narrower than a desktop (ui/screen.ts) the same controls fold into two sheets (ui/Popover `sheet`), so every one of
 * them stays reachable by touch and by keyboard: "More" holds the primary navigation and the app row's actions,
 * "View" the view row's controls but the breadcrumb, the search last as a field the sheet's width. On a tablet the
 * two rows stay (the wordmark, the badge and More; the breadcrumb and View); on a phone it is one row: the mark, the
 * breadcrumb (on the diagram page: the snapshot's scope down to the level drawn, resting at its end), View and More,
 * with the demo badge at the top of More. On a desktop the sheets are inline: no buttons, the rows as they are.
 * A sheet closes on a new page, and More after a pick that changes the view or the theme (a snapshot, a saved view,
 * a theme), focus back on its button (ui/Popover); Copy link, Export's menu and the account panel keep it open. On the
 * diagram page a sheet hangs over the canvas, at most two thirds of the canvas's height (the bar carries that height
 * as `--canvas-height`), its content scrolling inside it, so a third of the drawing stays in view while the controls
 * in it change the view, and a camera jump made meanwhile keeps its node there (the open sheet is marked
 * `data-canvas-overlay`, ui/Popover). Opening a sheet (its button, or `/` for View) closes the details drawer, which
 * lies over the canvas too, so the sheet is alone over it (state/store.ts, `apart`): the selection stays, its ring and
 * its trace with it, and no pick in the sheet that changes the view opens the drawer again. A node selected does: a tap
 * or a key on it once the sheet is closed, another node selected by a link or Back, or a search result picked in View,
 * which closes the sheet onto its button first. On a desktop, where the sheets are in place, the drawer stays as it is.
 */
export function TopBar(): ReactElement {
  // A demo build is a demo too, for the badge.
  const demoOnly = useDemoOnly();
  const onDiagram = useAppState((state) => state.view.onDiagram);
  // The instance's version, for a draw.io export's `agent` (none in the demo, which has no backend to ask).
  const version = useAppState((state) =>
    state.connect.backend.status === 'ready' && state.connect.backend.config.version !== UNKNOWN_VERSION
      ? state.connect.backend.config.version
      : undefined,
  );
  const diagramTarget = useDiagramLinkTarget();
  const screen = useScreen();
  const narrow = screen !== 'desktop';
  const phone = screen === 'phone';
  const [moreOpen, setMoreOpen] = useSheet(MORE_SHEET);
  const [viewOpen, setViewOpen] = useSheet(VIEW_SHEET);
  // The canvas's height as the diagram page measures it (state/hooks.ts), for the sheets hanging over it (their height
  // is at most two thirds of it, TopBar.module.css `.overCanvas`).
  const canvasHeight = useAppState((state) =>
    narrow && state.view.onDiagram ? (state.pipeline.canvas?.height ?? null) : null,
  );
  const store = useAppStore();
  const { pathname } = useLocation();
  const navItems: readonly NavItem[] = [
    { label: 'Connect', to: '/', end: true },
    { label: 'Diagram', to: diagramTarget },
    { label: 'Snapshots', to: '/snapshots' },
    { label: 'Permissions', to: '/permissions' },
    { label: 'Settings', to: '/settings' },
  ];

  // Another page, or another layout: no sheet stays open.
  useEffect(() => {
    store.updateUi((ui) => (ui.sheet === null ? ui : { ...ui, sheet: null, popover: null }));
  }, [store, pathname, screen]);

  // A pick that changes the view or the theme closes More (ui/Popover puts focus back on its button). A snapshot or
  // a saved view picked away from the diagram opens the diagram page: a new page, which closes the sheet by itself
  // (above) and starts focus at the page, so the pick leaves the sheet to it rather than moving focus twice.
  // `onDiagram` is this render's: the page the pick was made on, whatever the pick has written to the store since.
  const themePicked = (): void => {
    setMoreOpen(false);
  };
  const viewPicked = (): void => {
    if (onDiagram) setMoreOpen(false);
  };

  const badge = demoOnly ? (
    <span key="badge" className={styles.demoBadge} data-testid="demo-badge">
      Demo mode
    </span>
  ) : null;

  const viewFold = (
    <Popover
      key="view"
      label="View"
      sheet
      inline={!narrow}
      open={viewOpen}
      onOpenChange={setViewOpen}
      align="end"
      className={styles.fold}
      panelClassName={cx(styles.sheet, styles.viewSheet)}
    >
      <LensSelect />
      <FocusControl />
      <FiltersControl />
      <DetailControl />
      <SearchBox />
    </Popover>
  );

  return (
    <header
      className={cx(styles.topBar, phone && styles.phone, canvasHeight !== null && styles.overCanvas)}
      style={
        canvasHeight === null
          ? undefined
          : ({ '--canvas-height': `${String(canvasHeight)}px` } as CSSProperties)
      }
    >
      <div className={styles.appRow}>
        <Link key="home" to="/" className={styles.wordmark}>
          <img src={brandMarkSource()} alt="" className={styles.mark} data-testid="brand-mark" />
          {phone ? <span className="visually-hidden">{WORDMARK}</span> : WORDMARK}
        </Link>
        {phone ? null : badge}
        {phone && onDiagram ? <Breadcrumb key="breadcrumb" /> : null}
        {phone && onDiagram ? viewFold : null}
        <Popover
          key="more"
          label="More"
          sheet
          inline={!narrow}
          open={moreOpen}
          onOpenChange={setMoreOpen}
          align="end"
          className={styles.fold}
          panelClassName={cx(styles.sheet, styles.moreSheet)}
        >
          {phone ? badge : null}
          <nav key="nav" aria-label="Primary" className={styles.nav}>
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
          <div key="actions" className={styles.actions}>
            <SnapshotMenu onPick={viewPicked} />
            <SavedViewsButton onApplied={viewPicked} />
            <CopyLinkButton />
            <ThemeToggle onPick={themePicked} />
            <AccountMenu />
            <ExportMenu version={version} />
          </div>
        </Popover>
      </div>
      {onDiagram && !phone ? (
        <div className={styles.viewRow}>
          <Breadcrumb />
          {viewFold}
        </div>
      ) : null}
    </header>
  );
}
