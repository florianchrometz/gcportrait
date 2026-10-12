// SPDX-License-Identifier: MIT
/**
 * A select-only combobox (WAI-ARIA APG pattern), the top bar's pickers (Lens): a button with
 * `role="combobox"` named by its visible label and showing the current value; its listbox stays in the DOM
 * (hidden while closed) and focus stays on the button, the active option named by `aria-activedescendant`.
 *
 * Closed: ↓ ↑ Enter Space open on the current option, Home and End on the first and last, a typed character on
 * the next option starting with it. Open: ↓ ↑ move (no wrap), Home End jump, typed characters move (type-ahead),
 * Enter or Space choose, Tab chooses and moves on, Escape closes. A click on the button toggles, a click on an
 * option chooses it, a press elsewhere closes. `onChange` only fires for another value. Inert (`disabled`): a
 * focusable, announced-unavailable combobox that never opens.
 */
import { useId, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

import { cx } from '../classNames';
import styles from './controls.module.css';
import { inertProps, isInert, useOpenState, useOutsidePress, type Inert } from './dom';
import { Listbox } from './Listbox';
import { isTypeaheadKey, typeaheadMatch, useTypeahead } from './typeahead';

export interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** A second line under the label in the list (cut to the list's width; the whole text is its title). */
  readonly description?: string;
}

export interface SelectProps<T extends string> {
  /** The visible label, which names the combobox and its listbox. */
  readonly label: string;
  readonly options: readonly SelectOption<T>[];
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly disabled?: Inert;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly align?: 'start' | 'end';
  /** Extra class for the listbox popup (a width for options with descriptions). */
  readonly listClassName?: string | undefined;
}

export function Select<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
  open: controlled,
  onOpenChange,
  align = 'start',
  listClassName,
}: SelectProps<T>): ReactElement {
  const [open, setOpen] = useOpenState(controlled, onOpenChange);
  const [active, setActive] = useState(0);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const labelId = useId();
  const listId = useId();
  const type = useTypeahead();
  const inert = isInert(disabled);
  const shown = open && !inert;
  const selected = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const last = options.length - 1;
  useOutsidePress([anchorRef], shown, () => {
    setOpen(false);
  });

  const openAt = (index: number): void => {
    if (inert || options.length === 0) return;
    setActive(Math.min(last, Math.max(0, index)));
    setOpen(true);
  };
  const choose = (index: number): void => {
    setOpen(false);
    const option = options[index];
    if (option !== undefined && option.value !== value) onChange(option.value);
  };
  const typed = (key: string): number =>
    typeaheadMatch(
      options.map((option) => option.label),
      shown ? active : selected,
      type(key),
    );

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!shown) {
      const opening: Record<string, number> = {
        ArrowDown: selected,
        ArrowUp: selected,
        Enter: selected,
        ' ': selected,
        Home: 0,
        End: last,
      };
      const index = opening[event.key] ?? (isTypeaheadKey(event) ? typed(event.key) : undefined);
      if (index !== undefined && index >= 0) {
        event.preventDefault();
        openAt(index);
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((index) => Math.min(last, index + 1));
        return;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => Math.max(0, index - 1));
        return;
      case 'Home':
        event.preventDefault();
        setActive(0);
        return;
      case 'End':
        event.preventDefault();
        setActive(last);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        choose(active);
        return;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        return;
      case 'Tab':
        choose(active);
        return;
      default:
        if (isTypeaheadKey(event)) {
          const found = typed(event.key);
          if (found >= 0) {
            event.preventDefault();
            setActive(found);
          }
        }
    }
  };
  const optionId = (index: number): string => `${listId}-${String(index)}`;

  return (
    <span ref={anchorRef} className={cx(styles.field, styles.anchor)}>
      <span id={labelId} className={styles.fieldLabel}>
        {label}
      </span>
      <button
        type="button"
        role="combobox"
        className={styles.control}
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown ? optionId(active) : undefined}
        {...inertProps(disabled)}
        onClick={() => {
          if (shown) setOpen(false);
          else openAt(selected);
        }}
        onKeyDown={onKeyDown}
      >
        {options[selected]?.label ?? value}
        <span className={styles.caret} aria-hidden="true">
          ▾
        </span>
      </button>
      <Listbox
        id={listId}
        labelledBy={labelId}
        options={options.map((option, index) => ({
          key: option.value,
          label: option.label,
          ...(option.description === undefined ? {} : { description: option.description }),
          selected: index === selected,
        }))}
        active={active}
        optionId={optionId}
        hidden={!shown}
        align={align}
        checks
        className={listClassName}
        onActivate={setActive}
        onChoose={choose}
      />
    </span>
  );
}
