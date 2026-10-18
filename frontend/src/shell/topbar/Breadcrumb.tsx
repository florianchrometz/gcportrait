// SPDX-License-Identifier: Apache-2.0
import { useEffect, useLayoutEffect, useRef, type ReactElement, type RefObject } from 'react';

import { selectScope, useAppState, useDiagramActions, useScene } from '../../state';
import { focusVisible } from '../../ui/dom';
import { useScreen } from '../../ui/screen';
import { trailOf } from '../../views/trail';
import { useViewChoices } from '../../views/useViewChoices';
import styles from './Breadcrumb.module.css';

/**
 * Narrower than a desktop the trail scrolls sideways in its box instead of shrinking its crumbs: it rests scrolled to
 * its end, where the current level is, whenever the trail changes or a crumb or the box changes size (a font that
 * loaded, a phone turned), and `data-cut` marks a box scrolled away from its start, so the stylesheet fades the edge
 * where crumbs are out of view. A swipe scrolls the others into view, and so does focus: a crumb to drill out to that
 * takes focus from the keyboard (its focus ring shows) scrolls the trail the least that shows it whole, clear of the
 * fade (the box's scroll padding), where the browser's own scrolling on focus moves only a crumb wholly out of view;
 * while it keeps that focus, a change of size keeps it in view rather than the end. Focus from a pointer scrolls
 * nothing, so that a tap or a click lands on the crumb it was aimed at. The trail jumps, as it does to rest at its
 * end: no glide for reduced motion to stop.
 */
function useTrailAtItsEnd(navRef: RefObject<HTMLElement | null>, active: boolean, trail: string): void {
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!active || nav === null) return undefined;
    const mark = (): void => {
      nav.toggleAttribute('data-cut', nav.scrollLeft > 0.5);
    };
    const toEnd = (): void => {
      nav.scrollLeft = nav.scrollWidth - nav.clientWidth;
      mark();
    };
    // A crumb to drill out to (the current one is no button) with its focus ring.
    const ringed = (target: EventTarget | null): HTMLElement | null =>
      target instanceof HTMLButtonElement && nav.contains(target) && focusVisible(target) ? target : null;
    const show = (crumb: HTMLElement): void => {
      if (typeof crumb.scrollIntoView === 'function')
        crumb.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      mark();
    };
    const onFocusIn = (event: FocusEvent): void => {
      const crumb = ringed(event.target);
      if (crumb !== null) show(crumb);
    };
    const settle = (): void => {
      const crumb = ringed(nav.ownerDocument.activeElement);
      if (crumb === null) toEnd();
      else show(crumb);
    };
    toEnd();
    nav.addEventListener('scroll', mark, { passive: true });
    nav.addEventListener('focusin', onFocusIn);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(settle) : null;
    if (observer !== null) {
      observer.observe(nav);
      for (const crumb of nav.querySelectorAll('li')) observer.observe(crumb);
    }
    return () => {
      nav.removeEventListener('scroll', mark);
      nav.removeEventListener('focusin', onFocusIn);
      observer?.disconnect();
      nav.removeAttribute('data-cut');
    };
  }, [navRef, active, trail]);
}

/**
 * The scope breadcrumb with the drill-in trail: the scope the diagram shows ("example.com",
 * "No scope loaded" otherwise) and, when the view is drilled in (`root` in the hash), the containers above the
 * root down to the root itself (views/trail.ts, from the snapshot's containers). Every crumb but the current one
 * is a button that drills out to it (`actions.drillIn`, the scope with `null`); the current one is marked
 * `aria-current="location"`. Drilling in is the store's `actions.drillIn` too: the node menu's "Drill in" and a
 * double-click on a container (DiagramCanvas) and the details drawer call it. A root the scene builder
 * refused shows as "not found", and its scope crumb still drills out.
 *
 * A crumb drilled out to becomes the current one, which is no button, so the button that had focus goes away:
 * focus then moves to the new current crumb (focusable from script only), and the next Tab carries on from the
 * breadcrumb. On a phone or a tablet the trail scrolls sideways, resting at the current level (useTrailAtItsEnd).
 */
export function Breadcrumb(): ReactElement {
  const scope = useAppState(selectScope);
  const root = useAppState((state) => state.view.spec.root);
  const answer = useScene();
  const choices = useViewChoices();
  const { drillIn } = useDiagramActions();
  const currentRef = useRef<HTMLSpanElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const drilledOut = useRef(false);
  const narrow = useScreen() !== 'desktop';

  // After a drill-out from a crumb, focus goes to the crumb that is now the current one.
  useEffect(() => {
    if (!drilledOut.current) return;
    drilledOut.current = false;
    const active = currentRef.current?.ownerDocument.activeElement ?? null;
    if (active === null || active === active.ownerDocument.body) currentRef.current?.focus();
  }, [root]);

  const outcome = answer?.report.root;
  const used = outcome?.used !== undefined && outcome.used === root;
  const refused = root !== undefined && outcome?.requested === root && outcome.error !== undefined;
  const crumbs =
    scope === null
      ? []
      : trailOf({
          scope,
          root,
          containers: choices?.containers ?? null,
          organization: choices?.organization ?? null,
          ...(used && answer !== null ? { rootLabel: answer.scene.metadata.rootLabel } : {}),
        });
  const last = crumbs.length - 1;
  useTrailAtItsEnd(navRef, narrow, crumbs.map((crumb) => `${crumb.id ?? ''} ${crumb.label}`).join('\n'));

  if (scope === null) {
    return (
      <nav ref={navRef} aria-label="Scope" className={styles.breadcrumb}>
        <ol className={styles.list}>
          <li className={styles.crumb}>No scope loaded</li>
        </ol>
      </nav>
    );
  }

  return (
    <nav ref={navRef} aria-label="Scope" className={styles.breadcrumb}>
      <ol className={styles.list}>
        {crumbs.map((crumb, index) =>
          index === last ? (
            <li
              key={crumb.id ?? ''}
              className={styles.crumb}
              {...(last > 0 ? { 'aria-current': 'location' as const } : {})}
              title={
                refused
                  ? (outcome.error?.message ?? 'Not found')
                  : crumb.typeName === undefined
                    ? crumb.label
                    : `${crumb.typeName}: ${crumb.label}`
              }
            >
              <span ref={currentRef} className={styles.text} tabIndex={-1}>
                {crumb.label}
              </span>
              {refused ? <span className={styles.note}> (not found)</span> : null}
            </li>
          ) : (
            <li key={crumb.id ?? ''} className={styles.crumb}>
              <button
                type="button"
                className={styles.link}
                title={`Drill out to ${crumb.typeName === undefined ? '' : `${crumb.typeName.toLowerCase()} `}${crumb.label}`}
                onClick={() => {
                  drilledOut.current = true;
                  drillIn(crumb.id);
                }}
              >
                <span className={styles.text}>{crumb.label}</span>
              </button>
            </li>
          ),
        )}
      </ol>
    </nav>
  );
}
