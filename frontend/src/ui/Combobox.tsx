// SPDX-License-Identifier: MIT
/**
 * An editable combobox with a listbox popup (WAI-ARIA APG "list autocomplete"), for search results: a text input
 * with `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded` and `aria-controls`; the results listbox
 * shows while the input has focus and there are results; the active result is named by
 * `aria-activedescendant` (focus stays in the input) and marked `aria-selected`. The caller owns the text and
 * the results: `onValueChange` on every edit, `options` for the current text, `onChoose` for the chosen one.
 *
 * Keys: ↓ opens or moves down, ↑ moves up (both wrap), Alt+↓ opens without moving, Enter chooses the active
 * result, Escape closes the results and, when they are closed already, clears the text. A pointer over a result
 * makes it active, a click chooses it. A polite status line says how many results there are (or `noResults`;
 * `status` replaces it, for results that arrive later or a total beyond the list). Options may carry a group
 * name and a decorative icon (the search results, grouped by kind: Listbox.tsx).
 *
 * Results that arrive later (the search, answered by a worker): while `busy`, the options listed are an
 * earlier text's. They stay listed, so the list does not flicker, but greyed and `aria-busy`, and none can be made
 * active or chosen; ↓, ↑ and Enter pressed meanwhile are kept and apply to the current text's options once they
 * arrive. With `enterChoosesFirst`, Enter with no active option chooses the first (a search box's best result).
 * Inert (`disabled`): a focusable, read-only, announced-unavailable input.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react';

import { cx } from '../classNames';
import styles from './controls.module.css';
import { inertProps, isInert, useOpenState, type Inert } from './dom';
import { Listbox } from './Listbox';

export interface ComboboxOption {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  /** The group it is listed under (Listbox.tsx: consecutive options with one name form an ARIA group). */
  readonly group?: string;
  /** A decorative icon before its text. */
  readonly icon?: ReactNode;
}

export interface ComboboxProps {
  /** The input's accessible name (a visually hidden label). */
  readonly label: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  /** The results for the current text. */
  readonly options: readonly ComboboxOption[];
  readonly onChoose: (option: ComboboxOption) => void;
  readonly placeholder?: string;
  /** What the status line says when the text has no results. */
  readonly noResults?: string;
  readonly disabled?: Inert;
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly className?: string | undefined;
  /** What the status line says instead of "N results" (results that arrive later, a total beyond the list). */
  readonly status?: string;
  /** The input element (to focus it from a keyboard shortcut). */
  readonly inputRef?: Ref<HTMLInputElement>;
  /** `aria-keyshortcuts` of the input ("/"). */
  readonly keyShortcuts?: string;
  /** The results popup's side (`end`: right-aligned under the input) and extra class (width, scroll height). */
  readonly align?: 'start' | 'end';
  readonly listClassName?: string | undefined;
  /**
   * The options are an earlier text's; the current text's are on their way. They stay listed but cannot be made
   * active or chosen; ↓, ↑ and Enter pressed meanwhile apply to the new options when they arrive.
   */
  readonly busy?: boolean;
  /** Enter with no active option chooses the first one (a search box: Enter goes to the best result). */
  readonly enterChoosesFirst?: boolean;
}

/** Keys pressed while `busy`, for the options that arrive next: the option to make active, and whether to choose. */
interface Queued {
  readonly move: 'first' | 'last' | null;
  readonly choose: boolean;
}

export function Combobox({
  label,
  value,
  onValueChange,
  options,
  onChoose,
  placeholder,
  noResults = 'No results',
  disabled,
  open: controlled,
  onOpenChange,
  className,
  status: statusText,
  inputRef,
  keyShortcuts,
  align,
  listClassName,
  busy = false,
  enterChoosesFirst = false,
}: ComboboxProps): ReactElement {
  const [open, setOpen] = useOpenState(controlled, onOpenChange);
  const [active, setActive] = useState(-1);
  const inputId = useId();
  const listId = useId();
  const inert = isInert(disabled);
  const shown = open && !inert && options.length > 0;
  const count = options.length;
  // While busy no option is active: the listed ones are an earlier text's.
  const current = !busy && active < count ? active : -1;
  const queued = useRef<Queued | null>(null);
  const queue = (next: Partial<Queued>): void => {
    queued.current = {
      move: next.move ?? queued.current?.move ?? null,
      choose: next.choose ?? queued.current?.choose ?? false,
    };
  };

  const show = (index: number): void => {
    if (inert) return;
    setActive(index);
    setOpen(true);
  };
  const choose = (index: number): void => {
    const option = options[index];
    if (busy || option === undefined) return;
    setOpen(false);
    setActive(-1);
    onChoose(option);
  };

  // The keys pressed while busy, applied to the options that arrived (after every render: `choose` is this
  // render's, for this render's options).
  useEffect(() => {
    const next = queued.current;
    if (busy || next === null) return;
    queued.current = null;
    if (inert || !open || count === 0) return;
    const target =
      next.move === 'last' ? count - 1 : next.move === 'first' || (next.choose && enterChoosesFirst) ? 0 : -1;
    if (target < 0) return;
    if (next.choose) choose(target);
    else setActive(target);
  });

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (inert) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (busy) {
          setOpen(true);
          if (!event.altKey) queue({ move: 'first' });
        } else if (event.altKey) show(current);
        else if (!shown) show(count > 0 ? 0 : -1);
        else setActive((current + 1) % count);
        return;
      case 'ArrowUp':
        event.preventDefault();
        if (busy && open) queue({ move: 'last' });
        else if (shown) setActive(current <= 0 ? count - 1 : current - 1);
        return;
      case 'Enter': {
        if (busy) {
          if (open) {
            event.preventDefault();
            queue({ choose: true });
          }
          return;
        }
        const target = current >= 0 ? current : enterChoosesFirst ? 0 : -1;
        if (shown && target >= 0) {
          event.preventDefault();
          choose(target);
        }
        return;
      }
      case 'Escape':
        event.preventDefault();
        queued.current = null;
        if (shown) setOpen(false);
        else onValueChange('');
        setActive(-1);
        return;
      default:
    }
  };
  const optionId = (index: number): string => `${listId}-${String(index)}`;
  const status = statusText ?? (value === '' ? '' : count === 0 ? noResults : `${String(count)} results`);

  return (
    <span className={cx(styles.anchor, className)}>
      <label htmlFor={inputId} className="visually-hidden">
        {label}
      </label>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        className={styles.control}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        aria-keyshortcuts={keyShortcuts}
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={shown && current >= 0 ? optionId(current) : undefined}
        readOnly={inert}
        {...inertProps(disabled)}
        onChange={(event) => {
          if (inert) return;
          queued.current = null;
          onValueChange(event.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onFocus={() => {
          if (!inert && value !== '') setOpen(true);
        }}
        onClick={() => {
          // A press on the focused input opens the list again (after Escape, or a choice).
          if (!inert && !open && value !== '') setOpen(true);
        }}
        onBlur={() => {
          queued.current = null;
          setOpen(false);
        }}
        onKeyDown={onKeyDown}
      />
      <Listbox
        id={listId}
        label={label}
        options={options.map((option, index) => ({
          key: option.key,
          label: option.label,
          ...(option.description === undefined ? {} : { description: option.description }),
          ...(option.group === undefined ? {} : { group: option.group }),
          ...(option.icon === undefined ? {} : { icon: option.icon }),
          selected: index === current,
        }))}
        active={current}
        optionId={optionId}
        hidden={!shown}
        busy={busy}
        {...(align === undefined ? {} : { align })}
        className={listClassName}
        onActivate={(index) => {
          if (!busy) setActive(index);
        }}
        onChoose={choose}
      />
      <span role="status" className="visually-hidden">
        {status}
      </span>
    </span>
  );
}
