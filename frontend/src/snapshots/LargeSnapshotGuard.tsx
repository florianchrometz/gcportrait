// SPDX-License-Identifier: Apache-2.0
/**
 * The large-snapshot guard in React (largeSnapshot.ts has its rules): before the app draws a snapshot of more than
 * `LARGE_SNAPSHOT_ASSETS` assets it asks, in an alert dialog, "Draw it anyway" or "Cancel", with "Do not ask again
 * in this session". The provider (App.tsx, inside the snapshot library's) holds the one question on screen, the
 * snapshots the person chose to draw in this tab (never asked about again: a timeline step, a lens, a filter, a
 * flip or an export keeps the snapshot) and the session setting.
 *
 * Who asks, and where Cancel leaves the person: "Try the demo" before it generates the organisation (snapshots/
 * DemoEntry.tsx; the Connect page), Load on the Snapshots page (SnapshotTable.tsx), the Connect page's export
 * import once the files are read and before anything is stored (import/LoadExport.tsx; Cancel stores nothing), a
 * live pull or an export read from Cloud Storage the moment its count passes the threshold while it streams
 * (import/run.ts; Cancel stops the read and nothing is stored), and the diagram page itself for any other way in (a
 * link, the Snapshot menu, a saved view, Back and Forward: `useLargeSnapshotGate`, which holds the pipeline until
 * the person answers; Cancel goes back where the person came from). The Snapshots page's import draws nothing, so
 * it does not ask.
 */
import { DEMO_REF_PREFIX, type SnapshotRef } from '@gcportrait/model';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useLocation, useNavigate } from 'react-router';

import { cx } from '../classNames';
import controls from '../ui/controls.module.css';
import { Dialog } from '../ui/Dialog';
import {
  askingSilenced,
  isLarge,
  questionText,
  silenceAsking,
  sizeOf,
  tabSession,
  type LargeSnapshotQuestion,
  type SessionStore,
} from './largeSnapshot';
import styles from './LargeSnapshotGuard.module.css';
import { useSnapshotListing } from './SnapshotLibraryProvider';

export interface LargeSnapshotGuard {
  /**
   * Whether drawing this many assets asks first: not for a small snapshot, one the person already chose to draw
   * in this tab (`ref`), or once "Do not ask again in this session" was ticked.
   */
  readonly asks: (assets: number, ref?: SnapshotRef) => boolean;
  /**
   * Asks when `asks` says so, else answers true at once: true to draw it, false to stay. "Draw it anyway"
   * remembers the question's `ref`. An aborted `signal` takes the question back (answered false).
   */
  readonly confirm: (question: LargeSnapshotQuestion, signal?: AbortSignal) => Promise<boolean>;
  /** Remembers that the person chose to draw `ref` (a pull confirmed while it streamed, before it had a ref). */
  readonly remember: (ref: SnapshotRef) => void;
}

interface Asked {
  /** Tells questions apart (each gets a fresh dialog). */
  readonly id: number;
  readonly question: LargeSnapshotQuestion;
  readonly answer: (draw: boolean, silence: boolean) => void;
}

const GuardContext = createContext<LargeSnapshotGuard | null>(null);

/** A guard that never asks (no provider: some tests, which then draw any snapshot). */
const NEVER_ASKS: LargeSnapshotGuard = {
  asks: () => false,
  confirm: () => Promise.resolve(true),
  remember: () => undefined,
};

export function LargeSnapshotGuardProvider({
  children,
  session = tabSession(),
}: {
  readonly children: ReactNode;
  /** Where "Do not ask again in this session" is kept: the tab's sessionStorage (tests pass their own). */
  readonly session?: SessionStore | null;
}): ReactElement {
  const [store] = useState(() => session);
  // The questions waiting, the first one on screen.
  const [queue, setQueue] = useState<readonly Asked[]>([]);
  // The snapshots chosen in this tab and the session setting, read by `asks` at once (a choice made in one
  // handler holds for the navigation that follows it); `version` re-renders whoever reads the guard.
  const chosen = useRef<Set<string>>(new Set());
  const silenced = useRef(askingSilenced(store));
  const [version, setVersion] = useState(0);
  const asked = useRef(0);

  const remember = useCallback((ref: SnapshotRef): void => {
    if (ref === '' || chosen.current.has(ref)) return;
    chosen.current.add(ref);
    setVersion((current) => current + 1);
  }, []);

  const asks = useCallback(
    (assets: number, ref?: SnapshotRef): boolean =>
      isLarge(assets) && !silenced.current && !(ref !== undefined && chosen.current.has(ref)),
    // A new function whenever what it reads changed, so a component that reads the guard renders again.
    [version],
  );

  const confirm = useCallback(
    (question: LargeSnapshotQuestion, signal?: AbortSignal): Promise<boolean> => {
      if (!asks(question.assets, question.ref)) return Promise.resolve(true);
      if (signal?.aborted === true) return Promise.resolve(false);
      return new Promise<boolean>((resolve) => {
        asked.current += 1;
        const entry: Asked = {
          id: asked.current,
          question,
          answer: (draw, silence) => {
            signal?.removeEventListener('abort', withdraw);
            setQueue((current) => current.filter((other) => other !== entry));
            if (draw) {
              if (question.ref !== undefined) remember(question.ref);
              if (silence) {
                silenceAsking(store);
                silenced.current = true;
                setVersion((current) => current + 1);
              }
            }
            resolve(draw);
          },
        };
        function withdraw(): void {
          setQueue((current) => current.filter((other) => other !== entry));
          resolve(false);
        }
        signal?.addEventListener('abort', withdraw, { once: true });
        setQueue((current) => [...current, entry]);
      });
    },
    [asks, remember, store],
  );

  const guard = useMemo<LargeSnapshotGuard>(() => ({ asks, confirm, remember }), [asks, confirm, remember]);
  const [current] = queue;

  return (
    <GuardContext value={guard}>
      {children}
      {current === undefined ? null : <LargeSnapshotDialog key={current.id} asked={current} />}
    </GuardContext>
  );
}

/** The question on screen: an alert dialog, focus on Cancel, Escape cancels. */
function LargeSnapshotDialog({ asked }: { readonly asked: Asked }): ReactElement {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [silence, setSilence] = useState(false);
  const checkId = useId();
  const { title, description } = questionText(asked.question);
  return (
    <Dialog
      open
      alert
      title={title}
      description={description}
      initialFocus={cancelRef}
      onClose={() => {
        asked.answer(false, false);
      }}
      actions={
        <>
          <button
            ref={cancelRef}
            type="button"
            className={controls.control}
            onClick={() => {
              asked.answer(false, false);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className={cx(controls.control, controls.primary, styles.draw)}
            onClick={() => {
              asked.answer(true, silence);
            }}
          >
            Draw it anyway
          </button>
        </>
      }
    >
      <label className={styles.check} htmlFor={checkId}>
        <input
          id={checkId}
          type="checkbox"
          checked={silence}
          onChange={(event) => {
            setSilence(event.currentTarget.checked);
          }}
        />
        Do not ask again in this session
      </label>
    </Dialog>
  );
}

/** The guard of the app (one that never asks outside its provider). */
export function useLargeSnapshotGuard(): LargeSnapshotGuard {
  return useContext(GuardContext) ?? NEVER_ASKS;
}

/**
 * The diagram page's guard, for every way onto it the other pages do not ask on (a link, the Snapshot menu, a
 * saved view, Back and Forward): true while the pipeline must wait to draw snapshot `ref`, because the library's
 * listing (which holds a stored snapshot's count) is still being read or the person is being asked. Cancel goes
 * back to where the person came from, or, on a page opened at this link, to the Snapshots page (a stored
 * snapshot) or the Connect page (a demo organisation).
 */
export function useLargeSnapshotGate(ref: SnapshotRef): boolean {
  const guard = useLargeSnapshotGuard();
  const listing = useSnapshotListing();
  const navigate = useNavigate();
  const { key } = useLocation();
  const size = sizeOf(ref, listing?.snapshots ?? null);
  const assets = size === null || size === 'reading' ? null : size.assets;
  const approximate = size !== null && size !== 'reading' && size.approximate;
  const asking = assets !== null && guard.asks(assets, ref);
  const first = key === 'default';
  const back = useRef({ navigate, first });
  useEffect(() => {
    back.current = { navigate, first };
  });

  useEffect(() => {
    if (!asking) return undefined;
    const question = new AbortController();
    void guard.confirm({ assets, approximate, ref }, question.signal).then((draw) => {
      if (draw || question.signal.aborted) return;
      const { navigate: go, first: opened } = back.current;
      if (!opened) void go(-1);
      else void go(ref.startsWith(DEMO_REF_PREFIX) ? '/' : '/snapshots', { replace: true });
    });
    return () => {
      question.abort();
    };
  }, [guard, asking, assets, approximate, ref]);

  return size === 'reading' || asking;
}
