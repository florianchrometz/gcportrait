// SPDX-License-Identifier: MIT
/**
 * A popover: a button that opens a small non-modal dialog under it (the top bar's Focus parameters and Filters).
 * The button has `aria-haspopup="dialog"`, `aria-expanded` and, while open, `aria-controls` naming the panel;
 * the panel is `role="dialog"`, named by `title`. Opening moves focus to the panel's first focusable element (or
 * the panel); Tab and Shift+Tab stay inside it (a focus trap); Escape closes it and puts focus back on the
 * button; a press outside closes it and lets focus go where it went. `children` may be a function of `close`
 * (an Apply button). The open state can be the caller's (`open`, `onOpenChange`). Inert (`disabled`): a
 * focusable, announced-unavailable button that opens nothing.
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
}: PopoverProps): ReactElement {
  const [open, setOpen] = useOpenState(controlled, onOpenChange);
  const anchorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const inert = isInert(disabled);
  const shown = open && !inert;

  useEffect(() => {
    if (inert && open) setOpen(false);
  }, [inert, open, setOpen]);

  useLayoutEffect(() => {
    if (shown && panelRef.current !== null) focusFirstIn(panelRef.current);
  }, [shown]);

  useOutsidePress([anchorRef], shown, () => {
    setOpen(false);
  });

  const close = (): void => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (panelRef.current !== null) trapTab(event, panelRef.current);
  };

  return (
    <div ref={anchorRef} className={controls.anchor}>
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
      {shown ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={title ?? label}
          tabIndex={-1}
          className={cx(styles.popup, styles.anchored, styles.panel, align === 'end' && styles.end)}
          onKeyDown={onPanelKeyDown}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      ) : null}
    </div>
  );
}
