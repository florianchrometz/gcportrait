// SPDX-License-Identifier: Apache-2.0
/**
 * The snapshot library in React (App.tsx puts it inside the app store's provider): the library itself
 * (`useSnapshotLibrary`), its listing, re-read after every change (`useSnapshotListing`), and the Snapshot menu's
 * choices: the store's `snapshot.available` becomes the demo organisations plus every stored snapshot, so the top
 * bar offers what the Snapshots page lists without either knowing the other (coordination through the store). In
 * the same way it keeps the timeline's extra ticks (the stored exports and pulls of the open snapshot's scope,
 * timeline/extraTicks.ts) in the store's `timeline` slice, whenever the listing or the view's timeline changes.
 */
import { demoSizeOfRef, isSnapshotRef } from '@gcportrait/model';
import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from 'react';

import { DEMO_SNAPSHOTS, useAppStore, type SnapshotChoice } from '../state';
import { bindExtraTicks } from '../timeline/extraTicks';
import { demoLabel, distinctLabels } from './labels';
import { createSnapshotLibrary, type SnapshotLibrary } from './library';
import type { ListedSnapshot } from './repository';

export interface SnapshotListing {
  /** Whether snapshots reach IndexedDB (false: kept in memory, until the page is reloaded or closed). */
  readonly persistent: boolean;
  readonly snapshots: readonly ListedSnapshot[];
}

const SnapshotLibraryContext = createContext<SnapshotLibrary | null>(null);
const SnapshotListingContext = createContext<SnapshotListing | null>(null);

/**
 * The demo organisations first, then the stored snapshots the demo list does not already name, labelled as the
 * Snapshots page labels them (no two alike).
 */
export function snapshotChoices(snapshots: readonly ListedSnapshot[]): readonly SnapshotChoice[] {
  const choices: SnapshotChoice[] = [...DEMO_SNAPSHOTS];
  const known = new Set<string>(choices.map((choice) => choice.ref));
  const labels = distinctLabels(snapshots.map(({ record }) => record));
  for (const { record } of snapshots) {
    const ref = record.id;
    if (!isSnapshotRef(ref) || ref === '' || known.has(ref)) continue;
    known.add(ref);
    const size = demoSizeOfRef(ref);
    choices.push({
      ref,
      label: size !== null ? demoLabel(size) : (labels.get(record.id) ?? record.id),
    });
  }
  return choices;
}

function sameChoices(a: readonly SnapshotChoice[], b: readonly SnapshotChoice[]): boolean {
  return (
    a.length === b.length &&
    a.every((choice, index) => choice.ref === b[index]?.ref && choice.label === b[index].label)
  );
}

/** A library that keeps nothing and cannot generate: the default when the app is given none (some tests). */
function idleLibrary(): SnapshotLibrary {
  return createSnapshotLibrary({ database: Promise.resolve(null), worker: null });
}

export function SnapshotLibraryProvider({
  library,
  children,
}: {
  readonly library?: SnapshotLibrary | undefined;
  readonly children: ReactNode;
}): ReactElement {
  const [current] = useState<SnapshotLibrary>(() => library ?? idleLibrary());
  const [listing, setListing] = useState<SnapshotListing | null>(null);
  const store = useAppStore();

  useEffect(() => {
    let live = true;
    const refresh = (): void => {
      void Promise.all([current.persistent(), current.list()]).then(([persistent, snapshots]) => {
        if (live) setListing({ persistent, snapshots });
      });
    };
    refresh();
    const unsubscribe = current.subscribe(refresh);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [current]);

  useEffect(() => {
    if (listing === null) return;
    const available = snapshotChoices(listing.snapshots);
    store.updateSnapshot((snapshot) =>
      sameChoices(snapshot.available, available) ? snapshot : { ...snapshot, available },
    );
  }, [store, listing]);

  useEffect(() => {
    if (listing === null) return undefined;
    return bindExtraTicks(
      store,
      listing.snapshots.map(({ record }) => record),
    );
  }, [store, listing]);

  return (
    <SnapshotLibraryContext value={current}>
      <SnapshotListingContext value={listing}>{children}</SnapshotListingContext>
    </SnapshotLibraryContext>
  );
}

export function useSnapshotLibrary(): SnapshotLibrary {
  const library = useContext(SnapshotLibraryContext);
  if (library === null)
    throw new Error('The snapshot library is missing: render inside <SnapshotLibraryProvider>.');
  return library;
}

/** The stored snapshots and whether they persist; null until first read. */
export function useSnapshotListing(): SnapshotListing | null {
  return useContext(SnapshotListingContext);
}
