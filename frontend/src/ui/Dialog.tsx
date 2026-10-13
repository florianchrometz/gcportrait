// SPDX-License-Identifier: MIT
/**
 * A modal dialog (WAI-ARIA dialog pattern): rendered over a backdrop at the end of `<body>`, `role="dialog"`
 * with `aria-modal="true"`, named by its title and described by `description`. While open, everything else in
 * `<body>` is `inert` (unreachable by pointer, keyboard and assistive technology), focus moves to the first
 * focusable element of its content (else its Close button), Tab and Shift+Tab stay inside it, Escape and the
 * Close button close it (`onClose('escape' | 'close')`), a press on the backdrop too (`'backdrop'`); on closing,
 * focus goes back to where it was before it opened.
 *
 * An alert dialog (`alert`: the WAI-ARIA alertdialog pattern, `role="alertdialog"`) asks for a decision its own
 * actions make: it has no Close button, a press on the backdrop does nothing, Escape still closes it (the way to
 * cancel), and focus moves to `initialFocus` (its least destructive action) when given.
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import controls from './controls.module.css';
import styles from './Dialog.module.css';
import { focusFirstIn, trapTab } from './dom';

export type DialogCloseReason = 'escape' | 'close' | 'backdrop';

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly description?: string;
  readonly onClose: (reason: DialogCloseReason) => void;
  readonly children?: ReactNode;
  /** The dialog's own actions (Apply, Delete), at its foot. */
  readonly actions?: ReactNode;
  /** An alert dialog: a decision its actions make (no Close button; the backdrop does not close it). */
  readonly alert?: boolean;
  /** Where focus goes when it opens (else the first focusable element of its content). */
  readonly initialFocus?: RefObject<HTMLElement | null>;
}

export function Dialog(props: DialogProps): ReactElement | null {
  if (!props.open || typeof document === 'undefined') return null;
  return createPortal(<OpenDialog {...props} />, document.body);
}

function OpenDialog({
  title,
  description,
  onClose,
  children,
  actions,
  alert = false,
  initialFocus,
}: DialogProps): ReactElement {
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);
  const initialFocusRef = useRef(initialFocus);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Modal: the rest of the page is inert while the dialog is open; focus comes back where it was.
  useLayoutEffect(() => {
    const backdrop = backdropRef.current;
    if (backdrop === null) return undefined;
    const document = backdrop.ownerDocument;
    const before = document.activeElement;
    const made: Element[] = [];
    for (const element of document.body.children) {
      if (element === backdrop || element.hasAttribute('inert')) continue;
      element.setAttribute('inert', '');
      made.push(element);
    }
    const first = initialFocusRef.current?.current ?? null;
    if (first !== null) first.focus();
    else if (bodyRef.current !== null) focusFirstIn(bodyRef.current, closeRef.current ?? dialogRef.current);
    return () => {
      for (const element of made) element.removeAttribute('inert');
      if (before instanceof HTMLElement || before instanceof SVGElement) before.focus();
    };
  }, []);

  return (
    <div
      ref={backdropRef}
      className={styles.backdrop}
      onPointerDown={(event) => {
        if (!alert && event.target === event.currentTarget) onCloseRef.current('backdrop');
      }}
    >
      <div
        ref={dialogRef}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        tabIndex={-1}
        className={styles.dialog}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            onClose('escape');
            return;
          }
          if (dialogRef.current !== null) trapTab(event, dialogRef.current);
        }}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {alert ? null : (
            <button
              ref={closeRef}
              type="button"
              className={controls.control}
              onClick={() => {
                onClose('close');
              }}
            >
              Close
            </button>
          )}
        </div>
        {description === undefined ? null : (
          <p id={descriptionId} className={styles.description}>
            {description}
          </p>
        )}
        <div ref={bodyRef} className={styles.body}>
          {children}
        </div>
        {actions === undefined ? null : <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  );
}
