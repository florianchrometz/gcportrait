// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { appPath, DIAGRAM_PATH } from '../routes';
import { useAppState } from '../state';
import controls from '../ui/controls.module.css';
import { inertProps } from '../ui/dom';
import styles from './CopyLink.module.css';

/** How long the toast stays (ms). */
export const TOAST_MS = 4000;

/**
 * The link to a view: the diagram page with the view's hash, on this app's origin, below the build's base path
 * (`appBase`: "/" for an instance, "/demo/" for the static demo).
 */
export function viewLink(hash: string, base: string, appBase: string = import.meta.env.BASE_URL): string {
  return new URL(`${appPath(DIAGRAM_PATH, appBase)}${hash === '' ? '' : `#${hash}`}`, base).href;
}

/**
 * The top bar's "Copy link" button: copies the link to the view on screen, the diagram page with its
 * URL hash (the view's only state, so the link reopens exactly this view), to the clipboard, and says so in a
 * toast: a polite status message kept in the DOM, shown for four seconds. Inert away from the diagram page.
 */
export function CopyLinkButton(): ReactElement {
  const onDiagram = useAppState((state) => state.view.onDiagram);
  const hash = useAppState((state) => state.view.hash);
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const toast = (text: string): void => {
    if (timer.current !== null) clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => {
      setMessage('');
    }, TOAST_MS);
  };

  const copy = (): void => {
    if (!onDiagram) return;
    const link = viewLink(hash, window.location.href);
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (clipboard === undefined) {
      toast('Copying is not available here: copy the address bar instead.');
      return;
    }
    clipboard.writeText(link).then(
      () => {
        toast('Link copied to the clipboard.');
      },
      () => {
        toast('The browser did not allow copying: copy the address bar instead.');
      },
    );
  };

  return (
    <>
      <button
        type="button"
        className={controls.control}
        {...inertProps(onDiagram ? undefined : 'Open a diagram to copy its link')}
        onClick={copy}
      >
        Copy link
      </button>
      <p role="status" className={styles.toast} data-shown={message === '' ? undefined : ''}>
        {message}
      </p>
    </>
  );
}
