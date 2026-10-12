// SPDX-License-Identifier: MIT
/**
 * The details drawer's "What changed" section (docs/timeline.md): while the diagram on screen is a timeline
 * day compared with the day on screen before it, what changed about the selected node between the two days, as the
 * data worker answers it (drawer/changes.ts):
 *
 * - how the node itself changed ("Added since 2026-09-07.", "Removed …", "Changed …", "Not changed itself …"), in the
 *   words and with the day the legend uses (diagram/diff/words.ts);
 * - its `updateTime` on each day it exists;
 * - for a changed asset, the fields of `resource.data` that differ (a small deep diff, capped: drawer/fieldDiff.ts);
 * - for a container, what inside it was added, removed or changed, each by label with a jump link (capped, the rest
 *   counted). A removed node's link selects its ghost when the view draws one.
 */
import { useId, type ReactElement } from 'react';

import { comparesForward, dayLabel, dayName, sincePhrase } from '../diagram/diff/words';
import styles from './DetailsDrawer.module.css';
import { JumpLink } from './JumpLink';
import { changeStatusText, INSIDE_HEADINGS } from './text';
import type { ChangeList, FieldChange, NodeChanges, NodeRef } from './types';
import type { ChangesState } from './useNodeChanges';

/** The phrase naming the day compared with: "since 2026-09-07" or "compared with 2026-09-09". */
export function changesSince(
  changes: Pick<NodeChanges, 'since' | 'readTime'>,
  utcOffsetMinutes: number,
): string {
  return sincePhrase(changes.since, comparesForward(changes.since, changes.readTime), utcOffsetMinutes);
}

function FieldEntry({ entry }: { readonly entry: FieldChange }): ReactElement {
  return (
    <li className={styles.fieldChange} data-kind={entry.kind}>
      <code className={styles.value}>{entry.path}</code>{' '}
      {entry.kind === 'added' ? (
        <>
          <span className={styles.muted}>added:</span> <code className={styles.value}>{entry.after}</code>
        </>
      ) : entry.kind === 'removed' ? (
        <>
          <span className={styles.muted}>removed, was</span>{' '}
          <code className={styles.value}>{entry.before}</code>
        </>
      ) : (
        <>
          <code className={styles.value}>{entry.before}</code>
          <span className={styles.muted}> → </span>
          <code className={styles.value}>{entry.after}</code>
        </>
      )}
    </li>
  );
}

function Inside({
  kind,
  list,
  onJump,
}: {
  readonly kind: 'added' | 'removed' | 'changed';
  readonly list: ChangeList;
  readonly onJump: (target: NodeRef) => void;
}): ReactElement | null {
  if (list.entries.length === 0) return null;
  return (
    <div className={styles.group} data-inside={kind}>
      <h4 className={styles.groupTitle}>
        {INSIDE_HEADINGS[kind]} <span className={styles.count}>({list.entries.length + list.more})</span>
      </h4>
      <ul className={styles.relations}>
        {list.entries.map((entry) => (
          <li key={entry.id} className={styles.relation}>
            <JumpLink target={entry} onJump={onJump} />
            {entry.typeName === '' ? null : <span className={styles.typeName}> {entry.typeName}</span>}
          </li>
        ))}
      </ul>
      {list.more === 0 ? null : <p className={styles.note}>and {list.more} more</p>}
    </div>
  );
}

export function WhatChanged({
  state,
  utcOffsetMinutes,
  onJump,
  onJumpRemoved,
}: {
  readonly state: ChangesState;
  readonly utcOffsetMinutes: number;
  /** A jump to a node of the drawn day (added, changed). */
  readonly onJump: (target: NodeRef) => void;
  /** A jump to a node that was removed (its ghost, when drawn). */
  readonly onJumpRemoved: (target: NodeRef) => void;
}): ReactElement | null {
  const headingId = useId();
  if (state.status === 'none') return null;
  const changes = state.status === 'ready' ? state.value : null;
  const since = changes === null ? null : changesSince(changes, utcOffsetMinutes);
  return (
    <section className={styles.section} aria-labelledby={headingId} data-testid="what-changed">
      <h3 id={headingId} className={styles.sectionTitle}>
        What changed {since === null ? null : <span className={styles.count}>{since}</span>}
      </h3>
      {state.status === 'loading' ? <p className={styles.note}>Comparing the two days…</p> : null}
      {state.status === 'error' ? (
        <p className={styles.note} role="alert">
          What changed could not be worked out: {state.message}
        </p>
      ) : null}
      {state.status === 'ready' && changes === null ? (
        <p className={styles.note}>Not an asset on either day: nothing to compare.</p>
      ) : null}
      {changes === null || since === null ? null : (
        <>
          <p className={styles.changeStatus} data-status={changes.status}>
            {changeStatusText(changes.status, since)}
          </p>
          {changes.updateTime.before === undefined && changes.updateTime.after === undefined ? null : (
            <div className={styles.group} data-update-time="">
              <h4 className={styles.groupTitle}>updateTime</h4>
              <dl className={styles.facts}>
                {changes.updateTime.before === undefined ? null : (
                  <>
                    <dt>{dayName(changes.since, utcOffsetMinutes)}</dt>
                    <dd>
                      <code className={styles.value}>{changes.updateTime.before}</code>
                    </dd>
                  </>
                )}
                {changes.updateTime.after === undefined ? null : (
                  <>
                    <dt>{dayLabel({ readTime: changes.readTime }, utcOffsetMinutes)}</dt>
                    <dd>
                      <code className={styles.value}>{changes.updateTime.after}</code>
                    </dd>
                  </>
                )}
              </dl>
            </div>
          )}
          {changes.fields === undefined ? null : (
            <div className={styles.group} data-fields="">
              <h4 className={styles.groupTitle}>
                Fields of resource.data that differ{' '}
                <span className={styles.count}>({changes.fields.entries.length + changes.fields.more})</span>
              </h4>
              {changes.fields.entries.length === 0 ? (
                <p className={styles.note}>None: only its update time moved.</p>
              ) : (
                <ul className={styles.fieldChanges}>
                  {changes.fields.entries.map((entry) => (
                    <FieldEntry key={entry.path} entry={entry} />
                  ))}
                </ul>
              )}
              {changes.fields.more === 0 ? null : (
                <p className={styles.note}>and {changes.fields.more} more (Raw JSON shows this day’s data)</p>
              )}
            </div>
          )}
          <Inside kind="added" list={changes.inside.added} onJump={onJump} />
          <Inside kind="removed" list={changes.inside.removed} onJump={onJumpRemoved} />
          <Inside kind="changed" list={changes.inside.changed} onJump={onJump} />
        </>
      )}
    </section>
  );
}
