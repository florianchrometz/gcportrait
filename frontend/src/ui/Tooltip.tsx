// SPDX-License-Identifier: Apache-2.0
/**
 * A tooltip (WAI-ARIA tooltip pattern, WCAG 2.2 1.4.13): a short description of its trigger, shown after a
 * pointer rests on the trigger (`delay`) or at once when the trigger takes keyboard focus; it stays while the
 * pointer moves onto it, and goes on Escape, on blur and when the pointer leaves both. The text is always in the
 * DOM (`role="tooltip"`, hidden while not shown), and the trigger names it with `aria-describedby`: `children`
 * is a function that receives that id.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';

import { cx } from '../classNames';
import controls from './controls.module.css';
import styles from './Tooltip.module.css';

export interface TooltipProps {
  readonly content: string;
  /** Renders the trigger; put `describedBy` into its `aria-describedby`. */
  readonly children: (describedBy: string) => ReactElement;
  /** How long a resting pointer waits before the tooltip shows (ms). */
  readonly delay?: number;
  readonly placement?: 'below' | 'above';
}

export function Tooltip({ content, children, delay = 400, placement = 'below' }: TooltipProps): ReactElement {
  const id = useId();
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = (): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  const show = (after: number): void => {
    clear();
    if (after <= 0) setShown(true);
    else
      timer.current = setTimeout(() => {
        setShown(true);
      }, after);
  };
  const hide = (): void => {
    clear();
    setShown(false);
  };

  useEffect(() => clear, []);

  // Escape dismisses it wherever focus is (1.4.13 "dismissible").
  useEffect(() => {
    if (!shown) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [shown]);

  return (
    <span
      className={controls.anchor}
      onPointerEnter={() => {
        show(delay);
      }}
      onPointerLeave={hide}
      onFocus={() => {
        show(0);
      }}
      onBlur={hide}
    >
      {children(id)}
      <span
        id={id}
        role="tooltip"
        className={cx(styles.tooltip, placement === 'above' && styles.above)}
        hidden={!shown}
      >
        {content}
      </span>
    </span>
  );
}
