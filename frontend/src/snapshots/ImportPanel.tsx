// SPDX-License-Identifier: MIT
/**
 * Importing snapshot files: a drop zone and a file picker ("Choose files…", the keyboard's way in)
 * for `.gcportrait.json` bundles and Cloud Asset Inventory exports (newline-delimited JSON, one or more files of one
 * export; the picker does not filter by extension, because export objects often have none). The snapshot worker
 * reads them (`@gcportrait/ingest` for exports) with progress; problems are listed; what was imported is
 * announced. Nothing is uploaded. Without browser storage the import is unavailable, and says why; a file dropped
 * on the zone then is refused, not opened by the browser. An export that came without its operation.json may be
 * given its read time by hand (import/ReadTimeField.tsx); the snapshot then sits at that time on its scope's
 * timeline.
 */
import { useEffect, useId, useRef, useState, type DragEvent, type ReactElement } from 'react';

import { cx } from '../classNames';
import { ReadTimeField, useTypedReadTime } from '../import/ReadTimeField';
import controls from '../ui/controls.module.css';
import { inertProps } from '../ui/dom';
import { JobStatus, type JobState } from './JobStatus';
import { formatCount, snapshotLabel } from './labels';
import { useSnapshotLibrary } from './SnapshotLibraryProvider';
import styles from './Snapshots.module.css';
import { SnapshotJobError } from './worker/client';

export function ImportPanel({ available }: { readonly available: boolean }): ReactElement {
  const library = useSnapshotLibrary();
  const [state, setState] = useState<JobState>({ kind: 'idle' });
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [dropping, setDropping] = useState(false);
  const [subject, setSubject] = useState('the files');
  const typedTime = useTypedReadTime();
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const hintId = useId();
  const busy = state.kind === 'busy';
  const usable = available && library.canWork;
  const unavailable = usable
    ? undefined
    : available
      ? 'Importing is not available here'
      : 'Importing needs browser storage, which this browser does not allow here';

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const start = (files: readonly File[]): void => {
    if (!usable || busy || files.length === 0) return;
    const names = files.map((file) => file.name).join(', ');
    setSubject(names);
    setWarnings([]);
    if (typedTime.problem !== null) {
      setState({
        kind: 'failed',
        title: `Nothing was imported from ${names}.`,
        message: typedTime.problem,
        problems: [],
      });
      return;
    }
    setState({ kind: 'busy', progress: null });
    library
      .importFiles(
        files,
        (progress) => {
          if (mounted.current) setState({ kind: 'busy', progress });
        },
        typedTime.readTime === undefined ? {} : { readTime: typedTime.readTime },
      )
      .then(
        ({ records, warnings: notes }) => {
          if (!mounted.current) return;
          const what = records
            .map((record) => `${snapshotLabel(record.meta)} (${formatCount(record.meta.assetCount)} assets)`)
            .join('; ');
          setState({ kind: 'idle', message: `Imported ${what}.` });
          setWarnings(notes);
        },
        (error: unknown) => {
          if (!mounted.current) return;
          setState({
            kind: 'failed',
            title: `Nothing was imported from ${names}.`,
            message: error instanceof Error ? error.message : String(error),
            problems: error instanceof SnapshotJobError ? error.problems : [],
          });
        },
      );
  };

  // Files dragged over the zone are always taken from the browser, which would otherwise open a dropped file in the
  // tab and lose what is kept in memory; they are refused ("none") while importing is unavailable or running.
  const onDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    const accepted = usable && !busy;
    event.dataTransfer.dropEffect = accepted ? 'copy' : 'none';
    setDropping(accepted);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    setDropping(false);
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    start([...event.dataTransfer.files]);
  };

  return (
    <div className={styles.stack}>
      <div
        className={cx(styles.dropZone, dropping && styles.dropping)}
        data-testid="snapshot-drop-zone"
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={() => {
          setDropping(false);
        }}
        onDrop={onDrop}
      >
        <p className={styles.dropTitle}>Drop snapshot files here</p>
        <button
          type="button"
          className={controls.control}
          aria-describedby={hintId}
          {...inertProps(busy ? 'An import is running' : unavailable)}
          onClick={() => {
            if (usable && !busy) input.current?.click();
          }}
        >
          Choose files…
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          tabIndex={-1}
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])];
            event.currentTarget.value = '';
            start(files);
          }}
        />
        <p id={hintId} className={styles.note}>
          {usable
            ? 'gcportrait snapshot files (.gcportrait.json), or a Cloud Asset Inventory export: newline-delimited ' +
              'JSON with one asset per line (choose every file of one export together). The files are read in ' +
              'this browser; nothing is uploaded.'
            : `${unavailable ?? ''}.`}
        </p>
      </div>
      {usable ? <ReadTimeField state={typedTime} /> : null}
      <JobStatus state={state} subject={subject} label="Importing" />
      {warnings.length === 0 ? null : (
        <div className={styles.notice}>
          <p>Imported with notes:</p>
          <ul className={styles.list}>
            {warnings.map((warning, index) => (
              <li key={`${String(index)}:${warning}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
