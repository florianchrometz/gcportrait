// SPDX-License-Identifier: MIT
/**
 * The diagram's progressive-disclosure bar (skill gcp-diagram-layout §6), floating at the
 * bottom right of the canvas: "N of M shown" (the rects drawn, of those the view holds at detail `all`),
 * "Expand all" (opens the shallowest collapsed tier) and "Collapse all" (resets every expand and collapse made
 * by hand, and returns to Auto when the level in use is deeper), and a notice when flips went over the 48 cap or
 * when Auto picked another level because the diagram area changed size. Everything comes from the app store and
 * goes back through its actions; nothing here is in the URL hash but what the actions write. Inert buttons stay
 * focusable (`aria-disabled`, with the reason in their tooltip), as the app's other unavailable controls.
 */
import type { ReactElement } from 'react';

import { useAppState, useDiagramActions } from '../../state/hooks';
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

  const expandHint = canExpand
    ? nextLevel === null
      ? 'Opens the zones closed by hand'
      : `Opens the next detail level: ${nextLevel}`
    : 'Everything this view can show is open';
  const collapseHint = canCollapse
    ? 'Closes every zone opened by hand and goes back to the automatic detail level'
    : `Nothing opened by hand at the ${usedLevel ?? 'current'} level`;

  return (
    <div className={styles.bar}>
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
  );
}
