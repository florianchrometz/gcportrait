// SPDX-License-Identifier: Apache-2.0
/**
 * The search box (style skill §13): an editable combobox (ui/Combobox) over the Graph of the
 * view's snapshot, searched in the data worker (search/service.ts, ranking in search/rank.ts). Press `/`
 * anywhere outside a text field to focus it; type to list the results, grouped by kind (projects, networks,
 * resources, …) with icon, type and project; ↑ ↓ move, Enter or a click chooses (Enter with no active result
 * chooses the first, the best), Escape closes the list and then clears the text; a polite status line says how
 * many nodes matched. Choosing a result reveals it (search/useReveal.ts): selected and glided to when drawn, its
 * collapsed ancestors flipped open first, or, when the view leaves it out, the reveal dialog's offers (drill in,
 * the Everything lens, include the type).
 *
 * Only the current text's results can be chosen: while its answer is on its way the previous text's results stay
 * listed but greyed and `aria-busy` (ui/Combobox `busy`), the status line is empty, and ↓, ↑ and Enter pressed
 * meanwhile apply to the new results when they arrive (type or paste, then Enter, lands on the best result).
 *
 * The text the person searched is the view's `highlight` once a result is chosen (in the hash, so a link
 * carries it); while typing it is the box's own draft, which a choice, a new highlight or another snapshot drops.
 * It is shown on the diagram page only (the top bar's view row); with no snapshot or with one that could
 * not be loaded, the box is inert (focusable, announced unavailable, with a hint).
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { useDiagramSession } from '../../diagram/session';
import { isShortcutKey, isTypingTarget } from '../../keyboard/shortcuts';
import { ResultIcon } from '../../search/ResultIcon';
import { RevealDialog } from '../../search/RevealDialog';
import { hitDescription, KIND_LABELS, resultCount } from '../../search/text';
import { useReveal } from '../../search/useReveal';
import { groupHits, useSearchResults } from '../../search/useSearchResults';
import { selectDrawnDay, useAppState, useAppStore, useDiagramActions } from '../../state';
import { useTheme } from '../../theme/useTheme';
import { Combobox, type ComboboxOption } from '../../ui/Combobox';
import styles from './SearchBox.module.css';
import { VIEW_SHEET } from './sheets';
import topBar from './TopBar.module.css';

/** Text typed into the box: against which highlight and snapshot it was typed. */
interface Draft {
  readonly text: string;
  readonly base: string;
  readonly snapshot: string;
}

/** The search text in a `highlight` (only the search box writes it; a full resource name is searched too). */
function searchText(highlight: string | undefined): string {
  return highlight ?? '';
}

export function SearchBox(): ReactElement {
  const store = useAppStore();
  const actions = useDiagramActions();
  const onDiagram = useAppState((state) => state.view.onDiagram);
  const snapshot = useAppState((state) => state.view.spec.snapshot);
  const highlight = useAppState((state) => state.view.spec.highlight);
  const [open, setOpen] = useState(false);
  // The view's snapshot could not be loaded (unknown, unreadable): it has no Graph to search.
  const failed = useAppState(
    (state) => state.snapshot.status === 'error' && state.snapshot.ref === state.view.spec.snapshot,
  );
  const { workers } = useDiagramSession();
  const { resolved: theme } = useTheme();
  // The diagram page has created the workers by now (its pipeline asks for the view's Scene).
  const available = onDiagram && snapshot !== '' && !failed && workers() !== null;
  const hint = !onDiagram
    ? 'Search is not available here'
    : snapshot === ''
      ? 'Choose a snapshot to search it'
      : failed
        ? 'The snapshot could not be loaded'
        : 'Search is not available here';

  // The draft is the text typed since the view's highlight last changed, for this snapshot. Choosing a result
  // drops it (the result's text becomes the highlight), and so does any change of the highlight (a chosen result,
  // Back, a link) or of the snapshot: the draft is gone for good then, so a later view without a highlight shows
  // an empty box, never the text typed before (a stale "orders-db", say).
  const committed = searchText(highlight);
  const [draft, setDraft] = useState<Draft | null>(null);
  if (draft !== null && (draft.base !== committed || draft.snapshot !== snapshot)) setDraft(null);
  const value =
    draft !== null && draft.base === committed && draft.snapshot === snapshot ? draft.text : committed;

  // The day on screen: what the worker searches; the snapshot's own day until something is drawn.
  const drawnDay = useAppState(selectDrawnDay) ?? null;
  const results = useSearchResults(snapshot, drawnDay, value, available);
  const { pending, message, reveal, accept, dismiss, clearMessage } = useReveal();
  const inputRef = useRef<HTMLInputElement>(null);
  // Once a result is chosen the list stays closed when focus comes back to the box (the reveal dialog closing),
  // until the person types, presses a key in it or presses on it.
  const settled = useRef(false);

  // `/` focuses the box from anywhere but a text field (style skill §13), unless a modal dialog has made it inert. On a
  // phone or a tablet the box is in the top bar's View sheet: a closed sheet opens first, and the box takes focus once
  // it shows (after the sheet has put focus on its first control).
  const sheet = useAppState((state) => state.ui.sheet);
  const focusWhenShown = useRef(false);
  useEffect(() => {
    const input = inputRef.current;
    if (!focusWhenShown.current || input === null || input.closest('[hidden]') !== null) return;
    focusWhenShown.current = false;
    input.focus();
    input.select();
  }, [sheet]);
  useEffect(() => {
    if (!available) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      // Matched by the character typed, whatever the layout needed for it (Shift, Option, AltGr).
      if (event.key !== '/' || !isShortcutKey(event)) return;
      if (isTypingTarget(event.target)) return;
      const input = inputRef.current;
      if (input === null || input.closest('[inert]') !== null) return;
      event.preventDefault();
      if (input.closest('[hidden]') !== null) {
        focusWhenShown.current = true;
        store.updateUi((ui) => ({ ...ui, sheet: VIEW_SHEET, popover: null }));
        return;
      }
      input.focus();
      input.select();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [available, store]);

  // While `results.pending`, `answer` is the previous text's: listed, greyed, never chosen (`busy`).
  const answer = results.answer;
  const busy = results.pending;
  const hits = answer === null ? [] : groupHits(answer.hits);
  const options: ComboboxOption[] = hits.map((hit) => {
    const icon = answer?.icons[hit.icon];
    return {
      key: hit.id,
      label: hit.label,
      description: hitDescription(hit),
      group: KIND_LABELS[hit.kind],
      ...(icon === undefined ? {} : { icon: <ResultIcon icon={icon} theme={theme} /> }),
    };
  });
  // Never the previous text's count: empty until the current text's answer arrives.
  const status =
    !available || value.trim() === '' || busy
      ? ''
      : results.error !== null
        ? 'The search failed.'
        : answer === null
          ? ''
          : resultCount(answer.total, answer.hits.length);

  return (
    <div
      role="search"
      className={topBar.searchSlot}
      onFocus={() => {
        results.prepare();
      }}
      onKeyDownCapture={() => {
        settled.current = false;
      }}
      onPointerDownCapture={() => {
        settled.current = false;
      }}
    >
      <Combobox
        label="Search assets"
        placeholder="Search assets ( / )"
        value={value}
        onValueChange={(next) => {
          setDraft({ text: next, base: committed, snapshot });
          clearMessage();
          // Clearing the box clears the highlight it put into the view.
          if (next === '' && committed !== '') actions.highlight(null);
        }}
        options={options}
        onChoose={(option) => {
          // Only the current text's results (the combobox chooses none while busy; this keeps it so).
          const hit = busy ? undefined : hits.find((candidate) => candidate.id === option.key);
          if (hit === undefined) return;
          settled.current = true;
          setDraft(null);
          void reveal(hit, value.trim());
        }}
        noResults="No results"
        status={status}
        busy={busy}
        enterChoosesFirst
        {...(available ? {} : { disabled: hint })}
        open={open}
        onOpenChange={(next) => {
          if (next && settled.current) return;
          setOpen(next);
        }}
        inputRef={inputRef}
        keyShortcuts="/"
        align="end"
        className={styles.box}
        listClassName={styles.results}
      />
      <span role="status" className="visually-hidden">
        {message}
      </span>
      <RevealDialog pending={pending} onAccept={accept} onDismiss={dismiss} />
    </div>
  );
}
