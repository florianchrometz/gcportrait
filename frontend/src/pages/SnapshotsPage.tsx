// SPDX-License-Identifier: MIT
import { useRef } from 'react';

import { cx } from '../classNames';
import { ImportPanel } from '../snapshots/ImportPanel';
import { ScopeTimelines } from '../snapshots/ScopeTimelines';
import { useSnapshotListing } from '../snapshots/SnapshotLibraryProvider';
import styles from '../snapshots/Snapshots.module.css';
import { SnapshotTable } from '../snapshots/SnapshotTable';
import { StorageUsage } from '../snapshots/StorageUsage';
import page from './Page.module.css';
import { useDocumentTitle } from './useDocumentTitle';

/**
 * The snapshot library: the snapshots kept in this browser's IndexedDB with load, export and
 * delete; each scope's timeline as kept here (its snapshots, the exports and pulls that are its extra
 * ticks, the days read from Cloud Asset Inventory and cached, their sizes, deleting extra ticks, cached days or a
 * scope's whole cache); importing files; storage usage and "delete all". When the browser allows no storage, the
 * page says so: snapshots then live in memory until the page is reloaded or closed (the demo organisations still
 * open) and importing is off.
 */
export function SnapshotsPage() {
  useDocumentTitle('Snapshots');
  const listing = useSnapshotListing();
  const storedHeading = useRef<HTMLHeadingElement>(null);
  const storageHeading = useRef<HTMLHeadingElement>(null);
  const timelinesHeading = useRef<HTMLHeadingElement>(null);
  const persistent = listing?.persistent ?? true;
  const snapshots = listing?.snapshots ?? [];

  return (
    <div className={cx(page.page, styles.wide)}>
      <div className={page.intro}>
        <h1 className={page.title}>Snapshots</h1>
        <p className={page.lead}>Snapshots you load are kept in this browser and are never uploaded.</p>
      </div>

      {persistent ? null : (
        <div className={styles.notice} data-testid="snapshots-memory-notice">
          <p>
            <strong>This browser does not let gcportrait store data here</strong> (IndexedDB is unavailable,
            as in some private windows).
          </p>
          <p>
            Snapshots are kept in memory only until this page is reloaded or closed: the demo organisations
            work, but files cannot be imported.
          </p>
        </div>
      )}

      <section className={page.section} aria-labelledby="snapshots-stored">
        <h2 id="snapshots-stored" ref={storedHeading} tabIndex={-1} className={page.sectionTitle}>
          Stored snapshots
        </h2>
        {listing === null ? (
          <p className={page.note}>Reading the snapshots stored in this browser…</p>
        ) : (
          <SnapshotTable snapshots={snapshots} headingRef={storedHeading} />
        )}
      </section>

      <section className={page.section} aria-labelledby="snapshots-timelines">
        <h2 id="snapshots-timelines" ref={timelinesHeading} tabIndex={-1} className={page.sectionTitle}>
          Timelines by scope
        </h2>
        <p className={page.note}>
          What this browser keeps of each scope, in time order: its snapshots, the exports and pulls that
          appear on its timeline as extra ticks, and the days its timeline read from Cloud Asset Inventory.
        </p>
        {listing === null ? null : <ScopeTimelines snapshots={snapshots} headingRef={timelinesHeading} />}
      </section>

      <section className={page.section} aria-labelledby="snapshots-import">
        <h2 id="snapshots-import" className={page.sectionTitle}>
          Import
        </h2>
        <ImportPanel available={persistent} />
      </section>

      <section className={page.section} aria-labelledby="snapshots-storage">
        <h2 id="snapshots-storage" ref={storageHeading} tabIndex={-1} className={page.sectionTitle}>
          Storage
        </h2>
        <StorageUsage snapshots={snapshots} persistent={persistent} headingRef={storageHeading} />
      </section>
    </div>
  );
}
