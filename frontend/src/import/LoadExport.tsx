// SPDX-License-Identifier: MIT
/**
 * "Load export" on the Connect page: a Cloud Asset Inventory export, from files dropped here
 * (or chosen with "Choose files…", the keyboard's way in), read in this browser through the Snapshots page's import
 * (one export in one or more files, `.gcportrait.json` bundles too, and the export's `operation.json` among
 * them for its read time and scope, sidecar.ts); or from Cloud Storage, a `gs://` URI read by the backend with the
 * person's token (`POST /api/export/read`) and streamed into the import worker, with an `operation.json` added
 * here when there is one. The exact `gcloud` commands that make such an export are shown, their variables as fields
 * to fill in place and each with a Copy button (preflight/CommandBlock.tsx). On success the diagram
 * opens on the new snapshot, after any notes the import left. For an export without its operation.json the person
 * may type when it was taken (`parseTypedReadTime`), for either way in; the
 * sidecar's read time wins when both are given, and without either the read time is the latest asset change,
 * marked as estimated. The snapshot is then an extra tick on its scope's timeline at that time.
 */
import { useEffect, useId, useRef, useState, type DragEvent, type ReactElement } from 'react';

import { cx } from '../classNames';
import { CommandBlock } from '../preflight/CommandBlock';
import { JobStatus, type JobState } from '../snapshots/JobStatus';
import { formatUtc } from '../snapshots/labels';
import { useSnapshotLibrary } from '../snapshots/SnapshotLibraryProvider';
import { SnapshotJobError } from '../snapshots/worker/client';
import { useAppState, useDiagramActions } from '../state';
import { inertProps } from '../ui/dom';
import { copyCommand, DESCRIBE_COMMAND, exportCommand } from './commands';
import styles from './Import.module.css';
import { ImportStatus } from './ImportStatus';
import { runExportRead } from './run';
import { ReadTimeField, useTypedReadTime } from './ReadTimeField';
import { MAX_SIDECAR_BYTES, parseSidecar, SIDECAR_FILE_NAME, type ExportSidecar } from './sidecar';
import { useImportJob } from './useImportJob';

/** A gs:// URI as the backend takes it (backend/src/stream/export-read.ts checks it fully). */
const GCS_URI = /^gs:\/\/[a-z0-9][a-z0-9._-]{1,220}[a-z0-9](?:\/.*)?$/;

export function isGcsUri(text: string): boolean {
  return GCS_URI.test(text.trim());
}

export const READ_ACTION = 'Read from Cloud Storage';

export function LoadExport(): ReactElement {
  const library = useSnapshotLibrary();
  const { setSnapshot } = useDiagramActions();
  const signedIn = useAppState((state) => state.connect.session.status === 'signed-in');
  const scope = useAppState((state) => state.connect.scope);
  const job = useImportJob();
  const [uri, setUri] = useState('');
  const [sidecar, setSidecar] = useState<{ readonly name: string; readonly value: ExportSidecar } | null>(
    null,
  );
  const [sidecarProblem, setSidecarProblem] = useState<string | null>(null);
  const [files, setFiles] = useState<JobState>({ kind: 'idle' });
  const [fileNotes, setFileNotes] = useState<{
    readonly ref: string;
    readonly notes: readonly string[];
  } | null>(null);
  const [subject, setSubject] = useState('the files');
  const [dropping, setDropping] = useState(false);
  const typedTime = useTypedReadTime();
  const fileInput = useRef<HTMLInputElement>(null);
  const sidecarInput = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const ids = { drop: useId(), uri: useId(), uriHint: useId(), sidecar: useId() };
  const reading = files.kind === 'busy';
  const busy = reading || job.running;
  const typedProblem = typedTime.problem;
  const typedReadTime = typedTime.readTime;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const importFiles = (chosen: readonly File[]): void => {
    if (busy || chosen.length === 0) return;
    setSubject(chosen.map((file) => file.name).join(', '));
    setFileNotes(null);
    if (typedProblem !== null) {
      setFiles({ kind: 'failed', title: 'Nothing was imported.', message: typedProblem, problems: [] });
      return;
    }
    setFiles({ kind: 'busy', progress: null });
    library
      .importFiles(
        chosen,
        (progress) => {
          if (mounted.current) setFiles({ kind: 'busy', progress });
        },
        typedReadTime === undefined ? {} : { readTime: typedReadTime },
      )
      .then(
        ({ refs, warnings }) => {
          if (!mounted.current) return;
          const ref = refs.at(-1);
          setFiles({ kind: 'idle' });
          if (ref === undefined) return;
          if (warnings.length === 0) setSnapshot(ref);
          else setFileNotes({ ref, notes: warnings });
        },
        (error: unknown) => {
          if (!mounted.current) return;
          setFiles({
            kind: 'failed',
            title: 'Nothing was imported.',
            message: error instanceof Error ? error.message : String(error),
            problems: error instanceof SnapshotJobError ? error.problems : [],
          });
        },
      );
  };

  const readSidecar = (file: File | undefined): void => {
    if (file === undefined) return;
    setSidecarProblem(null);
    if (file.size > MAX_SIDECAR_BYTES) {
      setSidecar(null);
      setSidecarProblem(`${file.name} is too large to be an export's operation.`);
      return;
    }
    void file.text().then((text) => {
      if (!mounted.current) return;
      const value = parseSidecar(text);
      if (value === null) {
        setSidecar(null);
        setSidecarProblem(`${file.name} is not the operation of an asset export.`);
      } else setSidecar({ name: file.name, value });
    });
  };

  const trimmed = uri.trim();
  const uriBlocked = !signedIn
    ? 'Sign in with Google first'
    : busy
      ? 'An import is running'
      : !isGcsUri(trimmed)
        ? 'Type a gs:// URI first'
        : typedProblem !== null
          ? 'Correct the read time first'
          : undefined;

  const read = (): void => {
    if (uriBlocked !== undefined) return;
    const chosen = sidecar?.value ?? null;
    const readTime = typedReadTime;
    job.start((dependencies, dispatch, signal) =>
      runExportRead(dependencies, trimmed, chosen, dispatch, signal, readTime),
    );
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
    setDropping(!busy);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    setDropping(false);
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    importFiles([...event.dataTransfer.files]);
  };

  return (
    <div className={styles.stack}>
      <div className={styles.columns}>
        <div className={styles.stack}>
          <div
            className={cx(styles.dropZone, dropping && styles.dropping)}
            data-testid="export-drop-zone"
            onDragEnter={onDragOver}
            onDragOver={onDragOver}
            onDragLeave={() => {
              setDropping(false);
            }}
            onDrop={onDrop}
          >
            <p className={styles.dropTitle}>Drop the export’s files here</p>
            <button
              type="button"
              className={styles.secondary}
              aria-describedby={ids.drop}
              {...inertProps(busy ? 'An import is running' : undefined)}
              onClick={() => {
                if (!busy) fileInput.current?.click();
              }}
            >
              Choose files…
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              hidden
              tabIndex={-1}
              data-testid="export-files"
              onChange={(event) => {
                const chosen = [...(event.currentTarget.files ?? [])];
                event.currentTarget.value = '';
                importFiles(chosen);
              }}
            />
            <p id={ids.drop} className={styles.note}>
              Every file of one export (newline-delimited JSON), and its {SIDECAR_FILE_NAME} if you saved it.
              Read in this browser; nothing is uploaded.
            </p>
          </div>
          <JobStatus state={files} subject={subject} label="Importing the export" />
          {fileNotes === null ? null : (
            <div className={styles.notice}>
              <p>Imported with notes:</p>
              <ul className={styles.list}>
                {fileNotes.notes.map((note, index) => (
                  <li key={`${String(index)}:${note}`}>{note}</li>
                ))}
              </ul>
              <div className={styles.row}>
                <button
                  type="button"
                  className={styles.primary}
                  onClick={() => {
                    setSnapshot(fileNotes.ref);
                  }}
                >
                  Open the diagram
                </button>
              </div>
            </div>
          )}
        </div>

        <div className={styles.stack}>
          <label className={styles.label} htmlFor={ids.uri}>
            Or read it from Cloud Storage
          </label>
          <input
            id={ids.uri}
            className={styles.input}
            type="text"
            inputMode="url"
            spellCheck={false}
            autoComplete="off"
            placeholder="gs://BUCKET/export.json"
            aria-describedby={ids.uriHint}
            value={uri}
            onChange={(event) => {
              setUri(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') read();
            }}
          />
          <div className={styles.row}>
            <button type="button" className={styles.primary} {...inertProps(uriBlocked)} onClick={read}>
              {READ_ACTION}
            </button>
            <button
              type="button"
              className={styles.secondary}
              aria-describedby={ids.sidecar}
              {...inertProps(busy ? 'An import is running' : undefined)}
              onClick={() => {
                if (!busy) sidecarInput.current?.click();
              }}
            >
              {sidecar === null ? `Add ${SIDECAR_FILE_NAME}…` : `Replace ${SIDECAR_FILE_NAME}…`}
            </button>
            <input
              ref={sidecarInput}
              type="file"
              accept=".json,application/json"
              hidden
              tabIndex={-1}
              data-testid="export-sidecar"
              onChange={(event) => {
                readSidecar(event.currentTarget.files?.[0]);
                event.currentTarget.value = '';
              }}
            />
          </div>
          <p id={ids.uriHint} className={styles.note}>
            A single object (<code>--output-path</code>), or a prefix (<code>--output-path-prefix</code>):
            every object under it is read. The backend reads it with your sign-in, which needs{' '}
            <code>storage.objects.get</code> on the bucket.
          </p>
          <p id={ids.sidecar} className={styles.note}>
            {sidecar === null
              ? `Optional: the export’s ${SIDECAR_FILE_NAME} says when it was taken; without it the read time is the latest asset change, marked as estimated.`
              : `${sidecar.name}: ${
                  sidecar.value.readTime === undefined
                    ? 'no read time'
                    : `read time ${formatUtc(sidecar.value.readTime)}`
                }${sidecar.value.scope === undefined ? '' : `, ${sidecar.value.scope.kind} ${sidecar.value.scope.id}`}.`}
            {sidecar === null ? null : (
              <>
                {' '}
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => {
                    setSidecar(null);
                  }}
                >
                  Remove
                </button>
              </>
            )}
          </p>
          {sidecarProblem === null ? null : (
            <p role="alert" className={styles.inlineError}>
              {sidecarProblem}
            </p>
          )}
          <ImportStatus
            progress={job.progress}
            label="Reading the export from Cloud Storage"
            notes={job.notes}
            onCancel={job.cancel}
            onRetry={read}
            onOpen={job.openResult}
          />
        </div>
      </div>

      <ReadTimeField state={typedTime} />

      <details className={styles.details}>
        <summary>How to make an export with gcloud</summary>
        <ol className={styles.steps}>
          <li>
            Export every resource of the scope (the command prints the operation’s name):
            <div className={styles.command}>
              <CommandBlock command={exportCommand(scope)} />
            </div>
          </li>
          <li>
            Once it has finished, save the operation for its read time (optional):
            <div className={styles.command}>
              <CommandBlock command={DESCRIBE_COMMAND} />
            </div>
          </li>
          <li>
            Read it from Cloud Storage above, or copy it here and drop it with {SIDECAR_FILE_NAME}:
            <div className={styles.command}>
              <CommandBlock command={copyCommand()} />
            </div>
          </li>
        </ol>
      </details>
    </div>
  );
}
