// SPDX-License-Identifier: Apache-2.0
/**
 * An accessible menu (WAI-ARIA menu pattern): a context menu opened at a point (the diagram's node menu),
 * or a menu button's menu anchored under its trigger (MenuButton.tsx).
 *
 * - `role="menu"` named by `label`; items `menuitem` (an action, or a link when it has `href`),
 *   `menuitemradio` or `menuitemcheckbox` (`aria-checked`), with a roving tab index; the item `initialIndex`
 *   (the first by default) takes focus when the menu opens.
 * - ↓ ↑ move (wrapping), Home and End jump, typed characters move to the next item starting with them
 *   (type-ahead); Enter or Space activate; Escape closes (`'escape'`: the opener puts focus back); Tab closes and
 *   lets focus move on (`'tab'`); a press outside closes it (`'outside'`). Activating an item closes the menu
 *   (`'select'`) unless the item `keepOpen`s it (an option in a menu of options and actions).
 * - A link item opens its page in a new tab only when activated (`target="_blank"`,
 *   `rel="noopener noreferrer"`): nothing here ever opens a page by itself.
 * - At a point it is positioned `fixed` there, moved back inside the viewport when it would overflow.
 * - Items that share a `group` in a row sit in a `group` named by that caption, shown above them; a separator
 *   divides each run of items from the next (the Export menu's options and actions).
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';

import { cx } from '../classNames';
import { useOutsidePress } from './dom';
import styles from './popup.module.css';
import { isTypeaheadKey, typeaheadMatch, useTypeahead } from './typeahead';

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  /** `action` (the default): a menuitem, or a link with `href`; `radio` and `checkbox` carry `checked`. */
  readonly kind?: 'action' | 'radio' | 'checkbox';
  readonly checked?: boolean;
  /** A link item: the page it opens in a new tab when activated. */
  readonly href?: string;
  /** What activating it does (also called for a link item, after the link opened). */
  readonly onSelect?: () => void;
  /** Activating it leaves the menu open (radio and checkbox options of a menu that also holds actions). */
  readonly keepOpen?: boolean;
  /** Announced as unavailable (`aria-disabled`); focusable, activates nothing. */
  readonly disabled?: boolean;
  /** The caption of the labelled group the item belongs to, with the items next to it that share it. */
  readonly group?: string;
}

export type MenuCloseReason = 'escape' | 'tab' | 'outside' | 'select';

export interface MenuProps {
  /** The menu's accessible name. */
  readonly label: string;
  readonly items: readonly MenuItem[];
  /** Opens at this viewport (client) point, `fixed`: its top-left corner. Absent: anchored under its trigger. */
  readonly at?: { readonly x: number; readonly y: number };
  /** Anchored: which edge of the trigger the menu lines up with. */
  readonly align?: 'start' | 'end';
  readonly id?: string;
  /** The item focused when the menu opens. */
  readonly initialIndex?: number;
  /** Presses inside this element (the trigger and its anchor) are not "outside". */
  readonly insideRef?: RefObject<Element | null>;
  readonly onClose: (reason: MenuCloseReason) => void;
}

interface Run {
  readonly group: string | undefined;
  readonly start: number;
  readonly items: readonly MenuItem[];
}

/** The items in runs of one `group` each (an ungrouped run too), in order, with each run's first index. */
function runsOf(items: readonly MenuItem[]): readonly Run[] {
  const runs: Array<{ group: string | undefined; start: number; items: MenuItem[] }> = [];
  items.forEach((item, index) => {
    const last = runs.at(-1);
    if (last !== undefined && last.group === item.group) last.items.push(item);
    else runs.push({ group: item.group, start: index, items: [item] });
  });
  return runs;
}

const ROLES = { action: 'menuitem', radio: 'menuitemradio', checkbox: 'menuitemcheckbox' } as const;

export function Menu({
  label,
  items,
  at,
  align = 'start',
  id,
  initialIndex = 0,
  insideRef,
  onClose,
}: MenuProps): ReactElement {
  const menuId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const itemRefs = useRef<Array<HTMLAnchorElement | HTMLButtonElement | null>>([]);
  const start = Math.min(Math.max(0, initialIndex), Math.max(0, items.length - 1));
  const [active, setActive] = useState(start);
  const [position, setPosition] = useState(at);
  const onCloseRef = useRef(onClose);
  const type = useTypeahead();

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // At a point: keep the menu inside the viewport. Then focus the initial item.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list === null) return;
    if (at !== undefined) {
      const view = list.ownerDocument.defaultView;
      const width = view?.innerWidth ?? 0;
      const height = view?.innerHeight ?? 0;
      const box = list.getBoundingClientRect();
      setPosition({
        x: width > 0 && at.x + box.width > width ? Math.max(0, width - box.width - 4) : at.x,
        y: height > 0 && at.y + box.height > height ? Math.max(0, height - box.height - 4) : at.y,
      });
    }
    // Only when the menu opens (or is moved): the start item is the one of that moment.
    itemRefs.current[start]?.focus();
  }, [at]);

  useOutsidePress(insideRef === undefined ? [listRef] : [listRef, insideRef], true, () => {
    onCloseRef.current('outside');
  });

  const move = (index: number): void => {
    const count = items.length;
    if (count === 0) return;
    const next = ((index % count) + count) % count;
    setActive(next);
    itemRefs.current[next]?.focus();
  };

  const activate = (item: MenuItem): void => {
    if (item.disabled === true) return;
    item.onSelect?.();
    if (item.keepOpen !== true) onClose('select');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>): void => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(active + 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        move(active - 1);
        return;
      case 'Home':
        event.preventDefault();
        move(0);
        return;
      case 'End':
        event.preventDefault();
        move(items.length - 1);
        return;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose('escape');
        return;
      case 'Tab':
        onClose('tab');
        return;
      case ' ': {
        // Space activates a link item too (a link answers Enter only).
        const item = items[active];
        if (item?.href === undefined) return;
        event.preventDefault();
        itemRefs.current[active]?.click();
        return;
      }
      default:
        if (isTypeaheadKey(event)) {
          const found = typeaheadMatch(
            items.map((item) => item.label),
            active,
            type(event.key),
          );
          if (found >= 0) {
            event.preventDefault();
            move(found);
          }
        }
    }
  };

  const renderItem = (item: MenuItem, index: number): ReactElement => {
    const kind = item.kind ?? 'action';
    const common = {
      role: ROLES[kind],
      tabIndex: index === active ? 0 : -1,
      className: styles.item,
      'aria-disabled': item.disabled === true ? true : undefined,
      onFocus: () => {
        setActive(index);
      },
    };
    return (
      <li key={item.id} role="none">
        {item.href === undefined ? (
          <button
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            type="button"
            {...common}
            aria-checked={kind === 'action' ? undefined : item.checked === true}
            onClick={() => {
              activate(item);
            }}
          >
            {item.label}
          </button>
        ) : (
          <a
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            {...common}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => {
              if (item.disabled === true) event.preventDefault();
              activate(item);
            }}
          >
            {item.label}
          </a>
        )}
      </li>
    );
  };

  return (
    <ul
      ref={listRef}
      id={id}
      role="menu"
      aria-label={label}
      className={cx(
        styles.popup,
        at === undefined ? styles.anchored : styles.fixed,
        at === undefined && align === 'end' && styles.end,
      )}
      style={
        position === undefined
          ? undefined
          : { left: `${String(position.x)}px`, top: `${String(position.y)}px` }
      }
      onKeyDown={onKeyDown}
    >
      {runsOf(items).map((run, runIndex) => {
        const separator =
          runIndex === 0 ? null : (
            <li role="separator" className={styles.separator} key={`separator-${String(runIndex)}`} />
          );
        const entries = run.items.map((item, offset) => renderItem(item, run.start + offset));
        if (run.group === undefined) return [separator, ...entries];
        const captionId = `${menuId}-group-${String(runIndex)}`;
        return [
          separator,
          <li key={`group-${String(runIndex)}`} role="none">
            <ul role="group" aria-labelledby={captionId} className={styles.group}>
              <li id={captionId} role="presentation" className={styles.groupLabel}>
                {run.group}
              </li>
              {entries}
            </ul>
          </li>,
        ];
      })}
    </ul>
  );
}
