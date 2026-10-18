// SPDX-License-Identifier: Apache-2.0
/**
 * The diagram's progressive-disclosure bar (skill gcp-diagram-layout §6), floating at the
 * bottom right of the canvas (on a tablet the bottom left, on a phone a row above the details sheet, hidden while the
 * top bar's View or More sheet is open; clear of the drawer either way, DisclosureBar.module.css). While the details
 * drawer lies over the canvas (a phone's sheet, a tablet's panel), or a tablet's View or More sheet is open, the bar
 * is marked as a panel over the canvas (`data-canvas-overlay`), so a camera jump and a fit keep the drawing
 * clear of it too (diagram/DiagramCanvas, `clearRoom`). At rest it carries `data-canvas-jump` alone: the directed moves
 * (a jump, the keyboard's focus and pan, a zoom key's step, a flip's glide) keep a node clear of it, while a fit still
 * fills the whole canvas. It holds "N of M shown" (the
 * rects drawn, of those the view holds at detail `all`), "Expand all" (opens the shallowest collapsed tier and reopens
 * zones closed by hand) and "Collapse all" (closes every zone opened by hand, keeps those closed by hand, and returns
 * to Auto when the level in use is deeper),
 * each available only when it would change the drawing on screen, and a notice when flips went over the 48 cap or
 * when Auto picked another level because the diagram area changed size. Everything comes from the app store and
 * goes back through its actions; nothing here is in the URL hash but what the actions write. Inert buttons stay
 * focusable (`aria-disabled`, with the reason in their tooltip), as the app's other unavailable controls.
 */
import type { ReactElement } from 'react';

import { useAppState, useDiagramActions } from '../../state/hooks';
import { useScreen } from '../../ui/screen';
import { Tooltip } from '../../ui/Tooltip';
import controls from '../../ui/controls.module.css';
import styles from './DisclosureBar.module.css';
import {
  selectCanCollapseAll,
  selectCanExpandAll,
  selectExpandLevelName,
  selectRectsShown,
  selectRectsTotal,
  selectUsedLevelName,
  useDisclosureNotice,
} from './state';

const NUMBER = new Intl.NumberFormat('en');

/** "164 of 2,497 shown". */
export function shownText(shown: number, total: number): string {
  return `${NUMBER.format(shown)} of ${NUMBER.format(total)} shown`;
}

export function DisclosureBar(): ReactElement | null {
  const actions = useDiagramActions();
  const shown = useAppState(selectRectsShown);
  const total = useAppState(selectRectsTotal);
  const canExpand = useAppState(selectCanExpandAll);
  const canCollapse = useAppState(selectCanCollapseAll);
  const nextLevel = useAppState(selectExpandLevelName);
  const usedLevel = useAppState(selectUsedLevelName);
  const [notice, dismiss] = useDisclosureNotice();
  // The top bar's View or More sheet is open (on a phone the row steps aside for it, DisclosureBar.module.css).
  const underSheet = useAppState((state) => state.ui.sheet !== null);
  // The details drawer open over the canvas, which it does on a phone or a tablet (on a desktop it stands beside it).
  const drawerOpen = useAppState((state) => state.ui.drawerOpen && state.selection.selected !== null);
  const screen = useScreen();
  const overDrawer = drawerOpen && screen !== 'desktop';
  const overlay = overDrawer || (underSheet && screen === 'tablet');

  const expandHint = canExpand
    ? nextLevel === null
      ? 'Opens the zones closed by hand'
      : `Opens the next detail level: ${nextLevel}`
    : 'Everything this view can show is open';
  const collapseHint = canCollapse
    ? 'Closes every zone opened by hand and goes back to the automatic detail level'
    : `Nothing opened by hand at the ${usedLevel ?? 'current'} level`;

  // The frame is the canvas's area on a phone, which the bar's place depends on (DisclosureBar.module.css); no box
  // otherwise.
  return (
    <div className={styles.frame} data-top-sheet={underSheet ? '' : undefined}>
      <div
        className={styles.bar}
        data-canvas-overlay={overlay ? '' : undefined}
        data-canvas-jump=""
        data-canvas-resize=""
      >
        {/* A live region kept in the DOM while empty, so a new notice is announced. */}
        <div role="status" className={styles.live}>
          {notice === null ? null : (
            <div className={styles.notice}>
              <p className={styles.noticeText}>{notice}</p>
              <button type="button" className={controls.control} onClick={dismiss}>
                Dismiss
              </button>
            </div>
          )}
        </div>
        {shown === null || total === null ? null : (
          <div className={styles.panel} role="group" aria-label="Expand and collapse">
            <p className={styles.count} role="status">
              {shownText(shown, total)}
            </p>
            <Tooltip content={expandHint} placement="above">
              {(describedBy) => (
                <button
                  type="button"
                  className={controls.control}
                  aria-describedby={describedBy}
                  aria-disabled={canExpand ? undefined : true}
                  onClick={() => {
                    if (canExpand) actions.expandAll();
                  }}
                >
                  Expand all
                </button>
              )}
            </Tooltip>
            <Tooltip content={collapseHint} placement="above">
              {(describedBy) => (
                <button
                  type="button"
                  className={controls.control}
                  aria-describedby={describedBy}
                  aria-disabled={canCollapse ? undefined : true}
                  onClick={() => {
                    if (canCollapse) actions.collapseAll();
                  }}
                >
                  Collapse all
                </button>
              )}
            </Tooltip>
          </div>
        )}
      </div>
    </div>
  );
}
