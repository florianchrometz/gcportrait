// SPDX-License-Identifier: MIT
/**
 * What choosing a search result does (reveal.ts's decision table, carried out). The data worker locates the
 * node in the view in the hash on the day on screen (locate.ts); then, through the app
 * store's actions only:
 *
 * - drawn as itself: select it (the drawer opens, the selection ring pulses) and glide to it (`jumpTo`);
 * - inside collapsed zones: switch to the view with their flips added (one history entry), then the same;
 * - not in the view: the reveal dialog shows why and the offers (drill in, the Everything lens, include the type,
 *   clear the filters), each a view the worker has checked; choosing one switches to it, then the same;
 * - no offer works, or the snapshot has no such node: the dialog, or the status line, says so.
 *
 * The search text goes into the view's `highlight` with the selection, so the link carries what was searched. A
 * locate answer is for the view it was asked about: if the view changed meanwhile (before the answer, or while
 * the dialog was open: browser Back), the node is located again in the view as it is now.
 */
import type { ViewSpec, ViewSpecInput } from '@gcportrait/model';
import { useCallback, useState } from 'react';

import { isDataCancelled } from '../diagram/pipeline/dataClient';
import { useDiagramSession } from '../diagram/session';
import { FALLBACK_VIEWPORT, sceneKey, selectDrawnDay, useAppStore, useDiagramActions } from '../state';
import type { LocateAnswer, RevealOffer, SearchHit } from './protocol';

/** A reveal waiting for the person: the offers to choose from, or why the node cannot be shown. */
export interface PendingReveal {
  readonly hit: SearchHit;
  readonly text: string;
  readonly answer: Extract<LocateAnswer, { kind: 'offer' | 'unavailable' }>;
  /** The scene key of the view the answer is for (its offers are that view changed). */
  readonly key: string;
}

export interface Reveal {
  /** The reveal the dialog shows, if any. */
  readonly pending: PendingReveal | null;
  /** What the polite status line says about the last reveal (until `clearMessage`, the next search). */
  readonly message: string;
  /** Locates a chosen result and shows it (or asks how). */
  readonly reveal: (hit: SearchHit, text: string) => Promise<void>;
  /** Switches to an offer's view and shows the node. */
  readonly accept: (offer: RevealOffer) => void;
  /** Keeps the view as it is. */
  readonly dismiss: () => void;
  /** Empties the status line (the person is searching again). */
  readonly clearMessage: () => void;
}

/** How often a node is located again when the view changes under the answer. */
const ATTEMPTS = 3;

/** The view with the hit selected and the search text highlighted. */
function withPointers(view: ViewSpec, id: string, text: string): ViewSpecInput {
  const next: ViewSpecInput = { ...view, selection: id };
  if (text === '') delete next.highlight;
  else next.highlight = text;
  return next;
}

export function useReveal(): Reveal {
  const store = useAppStore();
  const actions = useDiagramActions();
  const { workers } = useDiagramSession();
  const [pending, setPending] = useState<PendingReveal | null>(null);
  const [message, setMessage] = useState('');

  /** Selects the node (switching to `view` first, when given) and glides to it once it is drawn. */
  const show = useCallback(
    (id: string, text: string, view: ViewSpec | null): void => {
      if (view === null) {
        actions.select(id);
        actions.highlight(text === '' ? null : text);
      } else {
        actions.setView(() => withPointers(view, id, text));
        // Opens the drawer (the hash already holds the selection).
        actions.select(id);
      }
      actions.jumpTo(id);
    },
    [actions],
  );

  const reveal = useCallback(
    async (hit: SearchHit, text: string): Promise<void> => {
      const data = workers()?.data;
      if (data === undefined) return;
      setMessage('');
      for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
        const state = store.getState();
        const spec = state.view.spec;
        const viewport = state.pipeline.viewport ?? state.pipeline.canvas ?? FALLBACK_VIEWPORT;
        // The day on screen: the view's `tick` may name a live day that is not drawn yet.
        const day = { tick: selectDrawnDay(state) ?? null };
        let answer: LocateAnswer;
        try {
          answer = await data.locate({ spec, day, viewport, node: hit.id, offers: true });
        } catch (error) {
          if (!isDataCancelled(error)) setMessage(`${hit.label} could not be located.`);
          return;
        }
        if (sceneKey(store.getState().view.spec) !== sceneKey(spec)) continue;
        switch (answer.kind) {
          case 'missing':
            setMessage(`${hit.label} is not in this snapshot.`);
            return;
          case 'shown':
            show(hit.id, text, null);
            return;
          case 'expand':
            show(hit.id, text, answer.view);
            setMessage(`Opened ${answer.opened.join(' › ')} to show ${hit.label}.`);
            return;
          case 'offer':
          case 'unavailable':
            setPending({ hit, text, answer, key: sceneKey(spec) });
            return;
        }
      }
    },
    [show, store, workers],
  );

  const accept = useCallback(
    (offer: RevealOffer): void => {
      if (pending === null) return;
      setPending(null);
      // The view changed under the dialog: the offer was for the old one, so locate the node again.
      if (sceneKey(store.getState().view.spec) !== pending.key) void reveal(pending.hit, pending.text);
      else show(pending.hit.id, pending.text, offer.view);
    },
    [pending, reveal, show, store],
  );

  const dismiss = useCallback((): void => {
    setPending(null);
  }, []);

  const clearMessage = useCallback((): void => {
    setMessage('');
  }, []);

  return { pending, message, reveal, accept, dismiss, clearMessage };
}
