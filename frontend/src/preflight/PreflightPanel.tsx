// SPDX-License-Identifier: Apache-2.0
/**
 * The preflight panel (docs/permissions.md): the "Check permissions" action for the
 * scope, mode and quota project in the app store, and the checklist it answers: one row per need, its status in
 * words (never by colour alone), what was found, who needs which permission where, Google's own answer when the
 * check could not tell, and copy-ready commands. In user mode the quota projects tried are listed with why each
 * did or did not work. The backend writes the commands; an email it did not know is the YOUR_EMAIL variable, a field
 * to fill in like every variable of a command (preflight/CommandBlock.tsx). Used by the Permissions page; the Connect
 * page can show it under its scope step.
 */
import type { ReactElement } from 'react';

import { useAuth } from '../auth';
import { cx } from '../classNames';
import { describeScope } from '../scope/scopeName';
import type { PreflightAnswer, PreflightItem, QuotaCandidate } from './api';
import { CommandBlock } from './CommandBlock';
import {
  CANDIDATE_SOURCES,
  EMAIL_PLACEHOLDER,
  explainCandidate,
  explainItem,
  ITEM_TITLES,
  outcomeHeadline,
  STATUS_LABELS,
  upstreamLabel,
} from './copy';
import controls from '../ui/controls.module.css';
import styles from './Preflight.module.css';
import { usePreflight } from './usePreflight';

const STATUS_MARKS: Readonly<Record<PreflightItem['status'], string>> = {
  ok: '✓',
  missing: '✕',
  unknown: '?',
};

type SubHeading = 'h3' | 'h4';

function ItemRow({
  item,
  answer,
  heading: Heading,
}: {
  readonly item: PreflightItem;
  readonly answer: PreflightAnswer;
  readonly heading: SubHeading;
}) {
  return (
    <li className={styles.item}>
      <span className={cx(styles.status, styles[item.status])}>
        <span aria-hidden="true" className={styles.mark}>
          {STATUS_MARKS[item.status]}
        </span>
        {STATUS_LABELS[item.status]}
      </span>
      <div className={styles.itemBody}>
        <Heading className={styles.itemTitle}>
          {ITEM_TITLES[item.id]}
          {item.blocking ? null : <span className={styles.optional}> (optional)</span>}
        </Heading>
        <p>{explainItem(item, answer)}</p>
        <dl className={styles.facts}>
          <dt>Permission</dt>
          <dd>
            <code>{item.permission}</code>
            {item.role === undefined ? null : (
              <>
                {' '}
                in <code>{item.role}</code>
              </>
            )}
          </dd>
          {item.member === undefined ? null : (
            <>
              <dt>For</dt>
              <dd>
                <code>{item.member}</code>
              </dd>
            </>
          )}
          <dt>On</dt>
          <dd>
            <code>{item.resource}</code>
          </dd>
          {item.upstream === undefined || item.status === 'ok' ? null : (
            <>
              <dt>Google answered</dt>
              <dd>{upstreamLabel(item.upstream)}</dd>
            </>
          )}
        </dl>
        {item.commands.length === 0 ? null : (
          <div className={styles.commands}>
            <p className={styles.commandsLabel}>
              {item.status === 'missing' ? 'To grant it:' : 'If it is missing, this grants it:'}
            </p>
            {item.commands.map((command) => (
              <CommandBlock key={command} command={command} />
            ))}
          </div>
        )}
      </div>
    </li>
  );
}

function CandidateRows({
  candidates,
  heading: Heading,
}: {
  readonly candidates: readonly QuotaCandidate[];
  readonly heading: SubHeading;
}) {
  return (
    <div className={styles.candidates}>
      <Heading className={styles.itemTitle}>Quota projects tried</Heading>
      <ol className={styles.candidateList}>
        {candidates.map((candidate) => (
          <li key={`${candidate.source}:${candidate.project}`} className={styles.candidate}>
            <p>
              <code>{candidate.project}</code> ({CANDIDATE_SOURCES[candidate.source]}):{' '}
              {explainCandidate(candidate)}
            </p>
            {candidate.commands.map((command) => (
              <CommandBlock key={command} command={command} />
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** One finished check, as a checklist. */
export function PreflightResult({
  answer,
  heading = 'h4',
}: {
  readonly answer: PreflightAnswer;
  /** The level of the rows' headings: one below the heading the result sits under. */
  readonly heading?: SubHeading;
}): ReactElement {
  const placeholder =
    answer.member === undefined &&
    [
      ...answer.items.flatMap((item) => item.commands),
      ...answer.candidates.flatMap((entry) => entry.commands),
    ].some((command) => command.includes(EMAIL_PLACEHOLDER));
  const mode = answer.mode === 'user' ? 'your account' : 'the service account';
  return (
    <div className={styles.result}>
      <p className={cx(styles.headline, answer.outcome === 'ready' ? styles.ready : styles.notReady)}>
        {outcomeHeadline(answer.outcome)}
      </p>
      <p className={styles.note}>
        Checked{' '}
        {describeScope({
          scope: answer.scope,
          ...(answer.displayName === undefined ? {} : { displayName: answer.displayName }),
        })}{' '}
        with {mode}
        {answer.mode === 'user' && answer.quotaProject !== undefined ? (
          <>
            ; requests use the quota of <code>{answer.quotaProject}</code>
          </>
        ) : null}
        .
      </p>
      {placeholder ? (
        <p className={styles.note}>
          Google did not say which account is signed in, so the commands have a field for{' '}
          <code>{EMAIL_PLACEHOLDER}</code>: fill in the email address of your Google account there.
        </p>
      ) : null}
      <ol className={styles.items}>
        {answer.items.map((item) => (
          <ItemRow key={item.id} item={item} answer={answer} heading={heading} />
        ))}
      </ol>
      {answer.candidates.length === 0 ? null : (
        <CandidateRows candidates={answer.candidates} heading={heading} />
      )}
    </div>
  );
}

/** The check's action, its progress and its result, for the store's scope, mode and quota project. */
export function PreflightPanel({ headingLevel = 3 }: { readonly headingLevel?: 2 | 3 }): ReactElement {
  const auth = useAuth();
  const { request, state, stale, canCheck, check } = usePreflight();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const checking = state.status === 'checking';
  const hint =
    request === null
      ? 'Pick a scope first'
      : !canCheck
        ? 'Sign in first'
        : checking
          ? 'Checking…'
          : undefined;

  return (
    <div className={styles.panel}>
      <Heading id="preflight-heading" className={styles.panelTitle}>
        Permission check
      </Heading>
      <div className={styles.actions}>
        <button
          type="button"
          className={cx(controls.control, controls.primary)}
          aria-disabled={hint === undefined ? undefined : 'true'}
          aria-describedby={hint === undefined ? undefined : 'preflight-hint'}
          onClick={() => {
            if (hint === undefined) check();
          }}
        >
          {state.status === 'idle' || stale ? 'Check permissions' : 'Check again'}
        </button>
        {hint === undefined ? null : (
          <span id="preflight-hint" className={styles.note}>
            {hint}
          </span>
        )}
      </div>
      <div role="status" className="visually-hidden">
        {checking ? 'Checking the permissions with Google…' : ''}
        {state.status === 'done' && !stale ? outcomeHeadline(state.answer.outcome) : ''}
      </div>
      {state.status === 'failed' ? (
        <div role="alert" className={styles.alert}>
          <p className={styles.alertTitle}>The check did not finish</p>
          <p>{state.message}</p>
        </div>
      ) : null}
      {state.status === 'done' ? (
        <>
          {stale ? (
            <p className={styles.note}>
              This result is for another scope, mode or quota project than the ones picked now. Check again to
              update it.
            </p>
          ) : null}
          {state.answer.outcome === 'sign-in' ? (
            <p className={styles.actions}>
              <button type="button" className={controls.control} onClick={auth.signIn}>
                Sign in again
              </button>
            </p>
          ) : null}
          <PreflightResult answer={state.answer} heading={headingLevel === 2 ? 'h3' : 'h4'} />
        </>
      ) : null}
    </div>
  );
}
