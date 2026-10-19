// SPDX-License-Identifier: Apache-2.0
/**
 * Importing snapshot files: a drop zone and a file picker ("Choose files…", the keyboard's way in)
 * for `.gcportrait.json` bundles and Cloud Asset Inventory exports (newline-delimited JSON, one or more files of one
 * export; the picker does not filter by extension, because export objects often have none). The snapshot worker
 * reads them (`@gcportrait/ingest` for exports) with progress; problems are listed; what was imported is
 * announced. Nothing is uploaded. Without browser storage the import is unavailable, and says why; a file dropped
 * on the zone then is refused, not opened by the browser. An export that came without its operation.json may be
 * given its read time by hand (import/ReadTimeField.tsx); the snapshot then sits at that time on its scope's
 * timeline. While the files are read, Cancel stops the import and stores nothing, and so does leaving the page
 * (useImportSignal.ts).
 */
import { useId, type ReactElement } from 'react';

import { cx } from '../classNames';
import { ReadTimeField } from '../import/ReadTimeField';
import { useFileImport } from '../import/useFileImport';
import controls from '../ui/controls.module.css';
import { inertProps } from '../ui/dom';
import { JobStatus } from './JobStatus';
import styles from './Snapshots.module.css';

export function ImportPanel({ available }: { readonly available: boolean }): ReactElement {
  const fileImport = useFileImport({ usable: available });
  const hintId = useId();
  const usable = fileImport.usable;
  const busy = fileImport.busy;
  const unavailable = usable
    ? undefined
    : available
      ? 'Importing is not available here'
      : 'Importing needs browser storage, which this browser does not allow here';

  return (
    <div className={styles.stack}>
      <div
        className={cx(styles.dropZone, fileImport.dropping && styles.dropping)}
        data-testid="snapshot-drop-zone"
        {...fileImport.dropHandlers}
      >
        <p className={styles.dropTitle}>Drop snapshot files here</p>
        <button
          ref={fileImport.chooseButton}
          type="button"
          className={controls.control}
          aria-describedby={hintId}
          {...inertProps(busy ? 'An import is running' : unavailable)}
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
          onChange={fileImport.onFileInputChange}
        />
        <p id={hintId} className={styles.note}>
          {usable
            ? 'gcportrait snapshot files (.gcportrait.json), or a Cloud Asset Inventory export: newline-delimited ' +
              'JSON with one asset per line (choose every file of one export together). The files are read in ' +
              'this browser; nothing is uploaded.'
            : `${unavailable ?? ''}.`}
        </p>
      </div>
      {usable ? <ReadTimeField state={fileImport.typedTime} /> : null}
      <JobStatus
        state={fileImport.state}
        subject={fileImport.subject}
        label="Importing"
        onCancel={fileImport.cancel}
      />
      {fileImport.warnings.length === 0 ? null : (
        <div className={styles.notice}>
          <p>Imported with notes:</p>
          <ul className={styles.list}>
            {fileImport.warnings.map((warning, index) => (
              <li key={`${String(index)}:${warning}`}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
