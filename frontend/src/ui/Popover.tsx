// SPDX-License-Identifier: MIT
/**
 * A popover: a button that opens a small non-modal dialog under it (the top bar's Focus parameters and Filters).
 * The button has `aria-haspopup="dialog"`, `aria-expanded` and, while open, `aria-controls` naming the panel;
 * the panel is `role="dialog"`, named by `title`. Opening moves focus to the panel's first focusable element (or
 * the panel); Tab and Shift+Tab stay inside it (a focus trap); Escape closes it and puts focus back on the
 * button; a press outside closes it and lets focus go where it went. `children` may be a function of `close`
 * (an Apply button). The open state can be the caller's (`open`, `onOpenChange`). Inert (`disabled`): a
 * focusable, announced-unavailable button that opens nothing.
 *
 * A sheet (`sheet`) is a fold of other controls (the top bar's View and More on a phone or a tablet; ui/screen.ts):
 * its content stays mounted while it is closed (hidden), so the controls keep their state and what one of them opened
 * (a modal dialog) stays open; an Escape a control in it has handled already (closing its own list) leaves the sheet
 * open, and so does a press while a modal dialog over it makes it inert. A sheet closed while focus is inside it (a
 * pick that closes it, a new layout) gives focus back to its button, as Escape does, rather than letting it drop to
 * the page's body with the hidden panel. With `inline` the fold has room: no button, and the same content laid out
 * in place as if there were no popover (the desktop), the same elements either way.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cx } from '../classNames';
import controls from './controls.module.css';
import { focusFirstIn, inertProps, isInert, trapTab, useOpenState, useOutsidePress, type Inert } from './dom';
import styles from './popup.module.css';

export interface PopoverProps {
  /** The button's text and name. */
  readonly label: string;
  /** Shown in the button after the label (a count badge); part of its name, so give it words for that. */
  readonly adornment?: ReactNode;
  /** The panel's accessible name (default: the button's). */
  readonly title?: string;
  readonly children: ReactNode | ((close: () => void) => ReactNode);
  readonly align?: 'start' | 'end';
  readonly disabled?: Inert;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** A fold of other controls (see above). */
  readonly sheet?: boolean;
  /** The content in place, without a button (a sheet with room for its controls). */
  readonly inline?: boolean;
  /** Classes for the anchor around the button and the panel, and for the panel. */
  readonly className?: string | undefined;
  readonly panelClassName?: string | undefined;
}

export function Popover({
  label,
  adornment,
  title,
  children,
  align = 'start',
  disabled,
  open: controlled,
  onOpenChange,
  sheet = false,
  inline = false,
  className,
  panelClassName,
}: PopoverProps): ReactElement {
  const [open, setOpen] = useOpenState(controlled, onOpenChange);
  const anchorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const inert = isInert(disabled);
  const shown = open && !inert && !inline;

  useEffect(() => {
    if ((inert || inline) && open) setOpen(false);
  }, [inert, inline, open, setOpen]);

  useLayoutEffect(() => {
    if (shown && panelRef.current !== null) focusFirstIn(panelRef.current);
  }, [shown]);

  // A sheet that closes with focus still inside it, or already dropped to the body (the control that had it went
  // away with the pick), gives it back to its button. Escape has put it there already; Sign out puts it elsewhere.
  const wasShown = useRef(false);
  useLayoutEffect(() => {
    const closed = wasShown.current && !shown;
    wasShown.current = shown;
    const panel = panelRef.current;
    const button = buttonRef.current;
    if (!sheet || !closed || panel === null || button === null) return;
    const active = panel.ownerDocument.activeElement;
    if (active === null || active === panel.ownerDocument.body || panel.contains(active)) button.focus();
  }, [sheet, shown]);

  useOutsidePress([anchorRef], shown, () => {
    // A modal dialog opened from the sheet (Saved views) makes it inert: a press in the dialog is not "outside".
    if (sheet && (anchorRef.current?.closest('[inert]') ?? null) !== null) return;
    setOpen(false);
  });

  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape' && !(sheet && event.defaultPrevented)) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (panelRef.current !== null) trapTab(event, panelRef.current);
  };

  const content = typeof children === 'function' ? children(close) : children;
  // The panel is the same element folded and in place, so the content keeps its state when the fold opens out.
  return (
    <div ref={anchorRef} className={cx(controls.anchor, inline && styles.inline, className)}>
      {inline ? null : (
        <button
          ref={buttonRef}
          type="button"
          className={controls.control}
          aria-haspopup="dialog"
          aria-expanded={shown}
          aria-controls={shown ? panelId : undefined}
          {...inertProps(disabled)}
          onClick={() => {
            if (!inert) setOpen(!open);
          }}
        >
          {label}
          {adornment}
          <span className={controls.caret} aria-hidden="true">
            ▾
          </span>
        </button>
      )}
      {inline ? (
        <div ref={panelRef} className={styles.inline}>
          {content}
        </div>
      ) : shown || sheet ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={title ?? label}
          tabIndex={-1}
          hidden={!shown}
          className={cx(
            styles.popup,
            styles.anchored,
            styles.panel,
            sheet && styles.sheet,
            align === 'end' && styles.end,
            panelClassName,
          )}
          onKeyDown={onPanelKeyDown}
        >
          {content}
        </div>
      ) : null}
    </div>
  );
}
