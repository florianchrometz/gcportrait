// SPDX-License-Identifier: MIT
/**
 * What the primitives share: closing on a press outside, keeping Tab inside a popup, moving focus in, and
 * telling an inert control's hint from a working one.
 */
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), ' +
  '[tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** The elements Tab reaches inside `container`, in document order (hidden ones left out). */
export function focusableIn(container: Element): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.tabIndex >= 0 && element.closest('[hidden], [inert]') === null,
  );
}

/** Focuses the first focusable element inside `container`, or `fallback`, or the container itself. */
export function focusFirstIn(container: HTMLElement, fallback?: HTMLElement | null): void {
  const target = focusableIn(container)[0] ?? fallback ?? container;
  target.focus();
}

/**
 * Keeps Tab and Shift+Tab inside `container` (a popover, a dialog): from the last focusable element Tab goes to
 * the first, and from the first (or the container) Shift+Tab goes to the last. Call it from the container's
 * keydown handler; it returns whether it handled the key.
 */
export function trapTab(event: KeyboardEvent, container: HTMLElement): boolean {
  if (event.key !== 'Tab') return false;
  const elements = focusableIn(container);
  const first = elements[0];
  const last = elements.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    container.focus();
    return true;
  }
  const active = container.ownerDocument.activeElement;
  if (event.shiftKey && (active === first || active === container)) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

/**
 * Calls `onOutside` when a pointer goes down outside every element in `inside` while `active` (capture phase,
 * so a press on another control closes this popup before that control acts).
 */
export function useOutsidePress(
  inside: ReadonlyArray<{ readonly current: Element | null }>,
  active: boolean,
  onOutside: () => void,
): void {
  const latest = useRef({ inside, onOutside });
  useEffect(() => {
    latest.current = { inside, onOutside };
  });
  useEffect(() => {
    if (!active) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (latest.current.inside.some((ref) => ref.current?.contains(target) === true)) return;
      latest.current.onOutside();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [active]);
}

/**
 * An inert control (`disabled`): announced as unavailable (`aria-disabled`), still focusable, and doing nothing
 * when activated (a control that cannot act yet). A string is the hint shown as its title.
 */
export type Inert = boolean | string | undefined;

export const INERT_HINT = 'Not available yet';

export function isInert(disabled: Inert): boolean {
  return disabled !== undefined && disabled !== false;
}

export function inertProps(disabled: Inert): { 'aria-disabled'?: true; title?: string } {
  if (!isInert(disabled)) return {};
  return { 'aria-disabled': true, title: typeof disabled === 'string' ? disabled : INERT_HINT };
}

/** Open state that a parent may own (`open` + `onOpenChange`) or leave to the component. */
export function useOpenState(
  controlled: boolean | undefined,
  onChange: ((open: boolean) => void) | undefined,
): readonly [boolean, (open: boolean) => void] {
  const [own, setOwn] = useState(false);
  const open = controlled ?? own;
  const setOpen = useCallback(
    (next: boolean): void => {
      if (controlled === undefined) setOwn(next);
      if (next !== open) onChange?.(next);
    },
    [controlled, onChange, open],
  );
  return [open, setOpen] as const;
}
