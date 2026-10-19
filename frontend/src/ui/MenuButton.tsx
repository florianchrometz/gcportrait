// SPDX-License-Identifier: Apache-2.0
/**
 * A menu button (WAI-ARIA menu button pattern): a button with `aria-haspopup="menu"`, `aria-expanded` and, while
 * open, `aria-controls` naming its Menu, anchored under it. Enter, Space or ↓ open the menu on its checked radio
 * item (else the first), ↑ on the last; a click toggles it. Escape and choosing an item close it and put focus
 * back on the button; Tab and a press elsewhere close it and let focus go. The open state can be the caller's
 * (`open`, `onOpenChange`: the app store's one-popup-at-a-time `ui.popover`). Inert (`disabled`) it stays a
 * focusable, announced-unavailable button that opens nothing. `className` adds to the control's classes (e.g.
 * the Export menu's `controls.primary`).
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

import { cx } from '../classNames';
import styles from './controls.module.css';
import { inertProps, isInert, useOpenState, type Inert } from './dom';
import { Menu, type MenuCloseReason, type MenuItem } from './Menu';

export interface MenuButtonProps {
  /** The button's text and name. */
  readonly label: string;
  readonly items: readonly MenuItem[];
  readonly align?: 'start' | 'end';
  readonly disabled?: Inert;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly className?: string | undefined;
}

export function MenuButton({
  label,
  items,
  align = 'start',
  disabled,
  open: controlled,
  onOpenChange,
  className,
}: MenuButtonProps): ReactElement {
  const [open, setOpen] = useOpenState(controlled, onOpenChange);
  const [initial, setInitial] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const inert = isInert(disabled);
  const checked = items.findIndex((item) => item.kind === 'radio' && item.checked === true);
  const first = checked < 0 ? 0 : checked;

  // An inert button never shows its menu.
  useEffect(() => {
    if (inert && open) setOpen(false);
  }, [inert, open, setOpen]);

  const openAt = (index: number): void => {
    if (inert || items.length === 0) return;
    setInitial(index);
    setOpen(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openAt(first);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAt(items.length - 1);
    }
  };

  const onClose = (reason: MenuCloseReason): void => {
    setOpen(false);
    if (reason === 'escape' || reason === 'select') buttonRef.current?.focus();
  };

  return (
    <div ref={anchorRef} className={styles.anchor}>
      <button
        ref={buttonRef}
        type="button"
        className={cx(styles.control, className)}
        aria-haspopup="menu"
        aria-expanded={open && !inert}
        aria-controls={open && !inert ? menuId : undefined}
        {...inertProps(disabled)}
        onClick={() => {
          if (open) setOpen(false);
          else openAt(first);
        }}
        onKeyDown={onKeyDown}
      >
        {label}
        <span className={styles.caret} aria-hidden="true">
          ▾
        </span>
      </button>
      {open && !inert ? (
        <Menu
          id={menuId}
          label={label}
          items={items}
          align={align}
          initialIndex={initial}
          insideRef={anchorRef}
          onClose={onClose}
        />
      ) : null}
    </div>
  );
}
