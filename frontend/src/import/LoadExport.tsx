// SPDX-License-Identifier: Apache-2.0
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
 *
 * A snapshot of more than 10 000 assets asks before it is stored and drawn (snapshots/LargeSnapshotGuard.tsx), and
 * Cancel stores nothing and leaves the card as it was. Dropped files ask once they are read, before the library
 * stores anything (`confirm`, library.importFiles). They may hold several snapshots (each bundle its own, beside one
 * export), of which the import opens the last, so they ask once, about that one: Cancel stores none of them, "Draw
 * it anyway" stores each once and opens the last without asking again; the others are stored undrawn, as the
 * Snapshots page's import stores them, and its Load asks about a large one (should the browser refuse to store the
 * last, the diagram page asks about the one opened instead). A Cloud Storage read asks the moment its count passes
 * 10 000 while it streams (import/run.ts), and Cancel stops the read. Leaving the page before the person has
 * answered takes the question back, and nothing is stored.
 *
 * While the dropped files are read, the card's Cancel stops the snapshot worker's job and stores nothing
 * ("Cancelled. Nothing was stored."), as a pull's Cancel does, and puts focus back on "Choose files…"; leaving the
 * page cancels the import the same way (snapshots/useImportSignal.ts), so none is stored after the person has gone.
 */
import type { SnapshotRef } from '@gcportrait/model';
import { useId, useRef, useState, type ReactElement } from 'react';

import { cx } from '../classNames';
import { CommandBlock } from '../preflight/CommandBlock';
import { JobStatus } from '../snapshots/JobStatus';
import { formatUtc } from '../snapshots/labels';
import { useLargeSnapshotGuard } from '../snapshots/LargeSnapshotGuard';
import { useAppState, useDiagramActions } from '../state';
import { inertProps } from '../ui/dom';
import controls from '../ui/controls.module.css';
import { copyCommand, DESCRIBE_COMMAND, exportCommand } from './commands';
import styles from './Import.module.css';
import { ImportStatus } from './ImportStatus';
import { runExportRead } from './run';
import { ReadTimeField } from './ReadTimeField';
import { MAX_SIDECAR_BYTES, parseSidecar, SIDECAR_FILE_NAME, type ExportSidecar } from './sidecar';
import { useFileImport } from './useFileImport';
import { useImportJob } from './useImportJob';

/** A gs:// URI as the backend takes it (backend/src/stream/export-read.ts checks it fully). */
const GCS_URI = /^gs:\/\/[a-z0-9][a-z0-9._-]{1,220}[a-z0-9](?:\/.*)?$/;

export function isGcsUri(text: string): boolean {
  return GCS_URI.test(text.trim());
}

export const READ_ACTION = 'Read from Cloud Storage';

export function LoadExport(): ReactElement {
  const guard = useLargeSnapshotGuard();
  const { setSnapshot } = useDiagramActions();
  const signedIn = useAppState((state) => state.connect.session.status === 'signed-in');
  const scope = useAppState((state) => state.connect.scope);
  const job = useImportJob();
  const [uri, setUri] = useState('');
  const [sidecar, setSidecar] = useState<{ readonly name: string; readonly value: ExportSidecar } | null>(
    null,
  );
  const [sidecarProblem, setSidecarProblem] = useState<string | null>(null);
  const [fileNotes, setFileNotes] = useState<{
    readonly ref: SnapshotRef;
    readonly notes: readonly string[];
  } | null>(null);

  const fileImport = useFileImport({
    busy: job.running,
    title: 'Nothing was imported.',
    confirm: (signal) => (candidates) => {
      const opened = candidates.at(-1);
      if (opened === undefined) return Promise.resolve(true);
      return guard.confirm({ assets: opened.assets, ref: opened.ref }, signal);
    },
    onStart: () => {
      setFileNotes(null);
    },
    onDone: ({ refs, warnings }) => {
      const ref = refs.at(-1);
      if (ref === undefined) return;
      if (warnings.length === 0) setSnapshot(ref);
      else setFileNotes({ ref, notes: warnings });
    },
  });

  const sidecarInput = useRef<HTMLInputElement>(null);
  const ids = { drop: useId(), uri: useId(), uriHint: useId(), sidecar: useId() };
  const busy = fileImport.busy;
  const typedProblem = fileImport.typedTime.problem;
  const typedReadTime = fileImport.typedTime.readTime;

  const readSidecar = (file: File | undefined): void => {
    if (file === undefined) return;
    setSidecarProblem(null);
    if (file.size > MAX_SIDECAR_BYTES) {
      setSidecar(null);
      setSidecarProblem(`${file.name} is too large to be an export's operation.`);
      return;
    }
    void file.text().then((text) => {
      if (!fileImport.mounted.current) return;
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

  return (
    <div className={styles.stack}>
      <div className={styles.columns}>
        <div className={styles.stack}>
          <div
            className={cx(styles.dropZone, fileImport.dropping && styles.dropping)}
            data-testid="export-drop-zone"
            {...fileImport.dropHandlers}
          >
            <p className={styles.dropTitle}>Drop the export’s files here</p>
            <button
              ref={fileImport.chooseButton}
              type="button"
              className={controls.control}
              aria-describedby={ids.drop}
              {...inertProps(busy ? 'An import is running' : undefined)}
              onClick={fileImport.openFilePicker}
            >
              Choose files…
            </button>
            <input
              ref={fileImport.fileInput}
              type="file"
              multiple
              hidden
              tabIndex={-1}
              data-testid="export-files"
              onChange={fileImport.onFileInputChange}
            />
            <p id={ids.drop} className={styles.note}>
              Every file of one export (newline-delimited JSON), and its {SIDECAR_FILE_NAME} if you saved it.
              Read in this browser; nothing is uploaded.
            </p>
          </div>
          <JobStatus
            state={fileImport.state}
            subject={fileImport.subject}
            label="Importing the export"
            onCancel={fileImport.cancel}
          />
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
                  className={cx(controls.control, controls.primary)}
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
            <button
              type="button"
              className={cx(controls.control, controls.primary)}
              {...inertProps(uriBlocked)}
              onClick={read}
            >
              {READ_ACTION}
            </button>
            <button
              type="button"
              className={controls.control}
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

      <ReadTimeField state={fileImport.typedTime} />

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
