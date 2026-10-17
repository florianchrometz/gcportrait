// SPDX-License-Identifier: MIT
import { decodeViewSpec, type LensId, type SnapshotRef } from '@gcportrait/model';
import { useId, useLayoutEffect, useRef, useState, type SyntheticEvent, type ReactElement } from 'react';

import { cx } from '../classNames';
import { humanLensId, useDiagramSession } from '../diagram/session';
import { useAppState, useDiagramActions, usePopover } from '../state';
import type { StoredView } from '../storage/db';
import controls from '../ui/controls.module.css';
import { Dialog } from '../ui/Dialog';
import { describeViewHash, suggestViewName, type ViewWords } from './describeView';
import { cleanViewName, MAX_VIEW_NAME, useSavedViews, useSavedViewStore } from './savedViewStore';
import styles from './SavedViewsDialog.module.css';
import { useViewChoices } from './useViewChoices';

/**
 * The names the summaries use: the Snapshot menu's labels, the catalog's lens titles, and the open snapshot's
 * container names for a drill-in root.
 */
function useViewWords(): ViewWords {
  const available = useAppState((state) => state.snapshot.available);
  const { lenses } = useDiagramSession();
  const choices = useViewChoices();
  return {
    snapshot: (ref: SnapshotRef) => available.find((choice) => choice.ref === ref)?.label ?? ref,
    lens: (id: LensId) => lenses?.find((lens) => lens.id === id)?.title ?? humanLensId(id),
    root: (id: string) => choices?.containers[id]?.label,
  };
}

/**
 * The top bar's "Saved views" button and its dialog (saved views in IndexedDB). The dialog saves the view on
 * screen under a name (its URL hash, so it reopens as its link would; a taken name is updated), and lists the
 * saved views, newest first, each to apply (`actions.setView`, a history entry, back to the diagram page),
 * rename or delete (at once, in the destructive control's colours). A status line says what happened and when
 * the browser keeps them for the session only. The views stay in this browser (views/savedViewStore.ts, over
 * the page's IndexedDB connection). `onApplied` follows an applied view, once the dialog has closed (the top
 * bar closes its More sheet).
 */
export function SavedViewsButton({ onApplied }: { readonly onApplied?: () => void }): ReactElement {
  const [open, setOpen] = usePopover('saved-views');
  return (
    <>
      <button
        type="button"
        className={controls.control}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setOpen(true);
        }}
      >
        Saved views
      </button>
      <Dialog
        open={open}
        title="Saved views"
        description="Views are kept in this browser only. Applying one opens it as its link would."
        onClose={() => {
          setOpen(false);
        }}
      >
        <SavedViewsPanel
          onApplied={() => {
            setOpen(false);
            onApplied?.();
          }}
        />
      </Dialog>
    </>
  );
}

function SavedViewsPanel({ onApplied }: { readonly onApplied: () => void }): ReactElement {
  const store = useSavedViewStore();
  const views = useSavedViews();
  const words = useViewWords();
  const { setView } = useDiagramActions();
  const hash = useAppState((state) => state.view.hash);
  const spec = useAppState((state) => state.view.spec);
  const canSave = useAppState((state) => state.view.onDiagram && state.view.spec.snapshot !== '');
  const [name, setName] = useState(() => (canSave ? suggestViewName(spec, words) : ''));
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const nameId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // After a rename ends, focus goes back to that row's Rename button (the field it had is gone).
  const refocus = useRef<string | null>(null);

  useLayoutEffect(() => {
    const id = refocus.current;
    if (id === null || editing !== null) return;
    refocus.current = null;
    const buttons = listRef.current?.querySelectorAll<HTMLElement>('[data-row-rename]') ?? [];
    [...buttons].find((button) => button.dataset['rowRename'] === id)?.focus();
  });

  const save = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!canSave) return;
    const clean = cleanViewName(name);
    if (clean === '') {
      setStatus('Give the view a name first.');
      nameRef.current?.focus();
      return;
    }
    store.save(clean, hash).then(
      ({ view, replaced, persisted }) => {
        const done = replaced ? `Updated “${view.name}”.` : `Saved “${view.name}”.`;
        setStatus(persisted ? done : `${done} This browser keeps it for this session only.`);
      },
      () => {
        setStatus('The view could not be saved.');
      },
    );
  };

  const remove = (view: StoredView, index: number): void => {
    // At once, with no question: a saved view is a name over a link, saved again in a moment from the
    // same view. Focus moves to the next row's Apply, the row above when this was the last, or the name
    // field when none is left.
    const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-row-apply]');
    const next = rows?.[index + 1] ?? rows?.[index - 1] ?? null;
    store.remove(view.id).then(
      () => {
        setStatus(`Deleted “${view.name}”.`);
        (next ?? nameRef.current)?.focus();
      },
      () => {
        setStatus('The view could not be deleted.');
      },
    );
  };

  return (
    <div className={styles.panel}>
      <form className={styles.save} onSubmit={save}>
        <label htmlFor={nameId} className={styles.label}>
          Name
        </label>
        <input
          ref={nameRef}
          id={nameId}
          type="text"
          className={controls.control}
          value={name}
          maxLength={MAX_VIEW_NAME}
          autoComplete="off"
          spellCheck={false}
          readOnly={!canSave}
          {...(canSave ? {} : { 'aria-disabled': true, title: 'Open a diagram to save its view' })}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <button
          type="submit"
          className={controls.control}
          {...(canSave ? {} : { 'aria-disabled': true, title: 'Open a diagram to save its view' })}
        >
          Save current view
        </button>
      </form>
      <p role="status" className={styles.status}>
        {status}
      </p>
      <h3 className={styles.heading}>
        Saved in this browser{views === null ? '' : ` (${String(views.length)})`}
      </h3>
      {views === null ? (
        <p className={styles.empty}>Reading the saved views…</p>
      ) : views.length === 0 ? (
        <p className={styles.empty}>No saved views yet.</p>
      ) : (
        <ul ref={listRef} className={styles.list}>
          {views.map((view, index) =>
            editing === view.id ? (
              <RenameRow
                key={view.id}
                view={view}
                onDone={(message) => {
                  refocus.current = view.id;
                  setEditing(null);
                  if (message !== null) setStatus(message);
                }}
              />
            ) : (
              <li key={view.id} className={styles.row}>
                <span className={styles.text}>
                  <span className={styles.name}>{view.name}</span>
                  <span className={styles.summary}>{describeViewHash(view.viewSpecHash, words)}</span>
                </span>
                <span className={styles.actions}>
                  <button
                    type="button"
                    className={controls.control}
                    data-row-apply=""
                    aria-label={`Apply ${view.name}`}
                    onClick={() => {
                      setView(() => decodeViewSpec(view.viewSpecHash));
                      onApplied();
                    }}
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    className={controls.control}
                    data-row-rename={view.id}
                    aria-label={`Rename ${view.name}`}
                    onClick={() => {
                      setEditing(view.id);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className={cx(controls.control, controls.danger)}
                    aria-label={`Delete ${view.name}`}
                    onClick={() => {
                      remove(view, index);
                    }}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

/** A saved view's row while it is renamed: Enter or Save keeps the name, Escape or Cancel drops it. */
function RenameRow({
  view,
  onDone,
}: {
  readonly view: StoredView;
  readonly onDone: (message: string | null) => void;
}): ReactElement {
  const store = useSavedViewStore();
  const [name, setName] = useState(view.name);
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  // The field takes focus as the row turns into it (the Rename button it replaces had it).
  useLayoutEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = (event: SyntheticEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const clean = cleanViewName(name);
    if (clean === '' || clean === view.name) {
      onDone(null);
      return;
    }
    store.rename(view.id, clean).then(
      () => {
        onDone(`Renamed “${view.name}” to “${clean}”.`);
      },
      () => {
        onDone('The view could not be renamed.');
      },
    );
  };

  return (
    <li className={styles.row}>
      <form className={styles.rename} onSubmit={submit}>
        <label htmlFor={inputId} className="visually-hidden">
          New name for {view.name}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          className={controls.control}
          value={name}
          maxLength={MAX_VIEW_NAME}
          autoComplete="off"
          spellCheck={false}
          onChange={(event) => {
            setName(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            // Escape ends the renaming, not the dialog.
            event.preventDefault();
            event.stopPropagation();
            onDone(null);
          }}
        />
        <button type="submit" className={controls.control}>
          Save name
        </button>
        <button
          type="button"
          className={controls.control}
          onClick={() => {
            onDone(null);
          }}
        >
          Cancel
        </button>
      </form>
    </li>
  );
}
