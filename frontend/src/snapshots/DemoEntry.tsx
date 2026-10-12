// SPDX-License-Identifier: MIT
/**
 * The Connect page's "Try the demo" (ADR 0014): choose a size, S to XL; a demo worker started for the
 * job (the demo generator runs in workers only, ADR 0029 as amended on 2026-10-11) generates that demo organisation
 * with its 35-day history (`@gcportrait/demo-data`), reads it through `@gcportrait/ingest`, and the library stores it
 * in IndexedDB as `demo:<size>` (in memory, until a reload, when the browser allows no storage); then the diagram
 * opens with `snapshot=demo:<size>` in the hash (`actions.setSnapshot`), focus moving to the page
 * (shell/AppShell.tsx). Progress and errors are shown under the button.
 */
import type { DemoSize } from '@gcportrait/model';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';

import { useDiagramActions } from '../state';
import { SegmentedControl } from '../ui/SegmentedControl';
import { JobStatus, type JobState } from './JobStatus';
import { DEMO_SIZE_INFO, demoAbout, demoLabel } from './labels';
import { useSnapshotLibrary } from './SnapshotLibraryProvider';
import styles from './Snapshots.module.css';
import { SnapshotJobError } from './worker/client';

const SIZE_OPTIONS = DEMO_SIZE_INFO.map((info) => ({ value: info.size, label: info.size }));

export function DemoEntry({ action }: { readonly action: string }): ReactElement {
  const library = useSnapshotLibrary();
  const { setSnapshot } = useDiagramActions();
  const [size, setSize] = useState<DemoSize>('S');
  const [state, setState] = useState<JobState>({ kind: 'idle' });
  const mounted = useRef(true);
  const aboutId = useId();
  const busy = state.kind === 'busy';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = (): void => {
    if (busy) return;
    setState({ kind: 'busy', progress: null });
    library
      .tryDemo(size, (progress) => {
        if (mounted.current) setState({ kind: 'busy', progress });
      })
      .then(
        ({ ref }) => {
          if (!mounted.current) return;
          setState({ kind: 'idle' });
          setSnapshot(ref);
        },
        (error: unknown) => {
          if (!mounted.current) return;
          setState({
            kind: 'failed',
            title: 'The demo organisation could not be prepared.',
            message: error instanceof Error ? error.message : String(error),
            problems: error instanceof SnapshotJobError ? error.problems : [],
          });
        },
      );
  };

  return (
    <div className={styles.stack}>
      <SegmentedControl
        label="Size"
        options={SIZE_OPTIONS}
        value={size}
        onChange={setSize}
        disabled={busy ? 'A demo organisation is being prepared' : undefined}
      />
      <p id={aboutId} className={styles.note}>
        {demoLabel(size)}: {demoAbout(size)}.
      </p>
      <div className={styles.row}>
        <button
          type="button"
          className={styles.primary}
          aria-describedby={aboutId}
          aria-disabled={busy ? true : undefined}
          onClick={start}
        >
          {action}
        </button>
      </div>
      <JobStatus
        state={state}
        subject={`demo organisation ${size}`}
        label="Preparing the demo organisation"
      />
    </div>
  );
}
