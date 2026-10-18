// SPDX-License-Identifier: Apache-2.0
/**
 * The reveal dialog (useReveal.ts): a chosen search result is not in the view. It says why (reveal.ts's facts,
 * in words) and offers the view changes the data worker found to show it ("Drill in to demo-web-1", "Switch to the
 * Everything lens", "Include the type …"), applied only when chosen; Close (or Escape) keeps the view. When no
 * change would show it, it only says why. On ui/Dialog: modal, focus on the first offer, back to the search box.
 */
import type { ReactElement } from 'react';

import controls from '../ui/controls.module.css';
import { Dialog } from '../ui/Dialog';
import type { RevealOffer } from './protocol';
import styles from './search.module.css';
import { offerLabel, revealReasons } from './text';
import type { PendingReveal } from './useReveal';

export function RevealDialog({
  pending,
  onAccept,
  onDismiss,
}: {
  readonly pending: PendingReveal | null;
  readonly onAccept: (offer: RevealOffer) => void;
  readonly onDismiss: () => void;
}): ReactElement | null {
  if (pending === null) return null;
  const { answer, hit } = pending;
  const reasons = revealReasons(answer.facts, answer.context);
  return (
    <Dialog
      open
      title={`${hit.label} is not in this view`}
      description={reasons.join(' ')}
      onClose={onDismiss}
    >
      {answer.kind === 'offer' ? (
        <div role="group" aria-label={`Ways to show ${hit.label}`} className={styles.offers}>
          {answer.offers.map((offer) => (
            <button
              key={offer.steps.join('+')}
              type="button"
              className={controls.control}
              onClick={() => {
                onAccept(offer);
              }}
            >
              {offerLabel(offer.steps, answer.context)}
            </button>
          ))}
        </div>
      ) : (
        <p className={styles.note}>No change to this view would show it.</p>
      )}
    </Dialog>
  );
}
