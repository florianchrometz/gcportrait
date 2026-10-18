// SPDX-License-Identifier: Apache-2.0
/**
 * The large-snapshot guard's rules (docs/modes.md, "At a glance"), as plain functions: a snapshot with more
 * than `LARGE_SNAPSHOT_ASSETS` assets (`@gcportrait/model`) is drawn only once the person has confirmed it, since
 * drawing that many at once is slow and heavy on memory. What the app knows of a snapshot's size before drawing
 * it (`sizeOf`: a stored snapshot's count in the library's listing; a demo organisation's rough count before it is
 * generated), the words of the question (`questionText`), and "Do not ask again in this session", which lives in
 * the tab's sessionStorage and nowhere else (never localStorage: it ends with the tab). The React side, the
 * dialog and the hooks, is LargeSnapshotGuard.tsx.
 */
import { DEMO_REF_PREFIX, isDemoSize, LARGE_SNAPSHOT_ASSETS, type SnapshotRef } from '@gcportrait/model';

import { DEMO_SIZE_INFO, formatCount } from './labels';
import type { ListedSnapshot } from './repository';

/** Whether drawing this many assets at once asks first. */
export function isLarge(assets: number): boolean {
  return assets > LARGE_SNAPSHOT_ASSETS;
}

/** What the app knows of a snapshot's size before drawing it. */
export interface SnapshotSize {
  readonly assets: number;
  /** A rough count: a demo organisation that is not stored yet ("about 50,000"). */
  readonly approximate: boolean;
}

/**
 * The size of snapshot `ref`: a stored snapshot's asset count from the library's listing; a demo organisation's
 * rough count when it is not stored; `reading` while the listing has not been read (a stored ref may be large);
 * null when the app cannot know (a ref this browser does not hold, which the diagram then reports).
 */
export function sizeOf(
  ref: SnapshotRef,
  listed: readonly ListedSnapshot[] | null,
): SnapshotSize | 'reading' | null {
  if (ref === '') return null;
  const stored = listed?.find(({ record }) => record.id === ref)?.record;
  if (stored !== undefined) return { assets: stored.meta.assetCount, approximate: false };
  const size = ref.startsWith(DEMO_REF_PREFIX) ? ref.slice(DEMO_REF_PREFIX.length) : null;
  if (isDemoSize(size)) {
    const info = DEMO_SIZE_INFO.find((entry) => entry.size === size);
    return info === undefined ? null : { assets: info.assets, approximate: true };
  }
  return listed === null ? 'reading' : null;
}

/** A snapshot about to be drawn, as the question names it. */
export interface LargeSnapshotQuestion {
  /** Its asset count, or the count read so far (`reading`). */
  readonly assets: number;
  /** A rough count (a demo organisation not generated yet). */
  readonly approximate?: boolean;
  /**
   * Still being read, a live pull or an export from Cloud Storage: the count is what was read so far, and Cancel
   * stops the read (nothing is stored).
   */
  readonly reading?: 'pull' | 'export';
  /** The snapshot, once it has a ref: "Draw it anyway" means this one, and it is not asked about again. */
  readonly ref?: SnapshotRef;
}

/** The question's title and its words: how many assets, why that matters, and that the diagram still works. */
export function questionText(question: LargeSnapshotQuestion): {
  readonly title: string;
  readonly description: string;
} {
  const count = formatCount(question.assets);
  const why = `Drawing more than ${formatCount(LARGE_SNAPSHOT_ASSETS)} assets at once is slow and heavy on memory; the diagram will still work.`;
  if (question.reading === 'pull')
    return {
      title: 'Draw a large snapshot?',
      description: `This pull has read ${count} assets so far, and there may be more. ${why} Cancel stops the pull; nothing is stored.`,
    };
  if (question.reading === 'export')
    return {
      title: 'Draw a large snapshot?',
      description: `This export has ${count} assets so far, and there may be more. ${why} Cancel stops reading it; nothing is stored.`,
    };
  return {
    title: 'Draw a large snapshot?',
    description: `This snapshot has ${question.approximate === true ? 'about ' : ''}${count} assets. ${why}`,
  };
}

/** The sessionStorage key of "Do not ask again in this session". */
export const DRAW_LARGE_KEY = 'gcportrait.drawLargeSnapshots';

/** The part of the Storage API the setting uses (the tab's sessionStorage; tests pass their own). */
export type SessionStore = Pick<Storage, 'getItem' | 'setItem'>;

/** The tab's sessionStorage, or null where the browser refuses it (some private windows, a sandbox). */
export function tabSession(): SessionStore | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/** Whether the person asked not to be asked again in this tab. */
export function askingSilenced(store: SessionStore | null): boolean {
  try {
    return store?.getItem(DRAW_LARGE_KEY) === 'draw';
  } catch {
    return false;
  }
}

/** "Do not ask again in this session": kept in the tab's sessionStorage, or, where it refuses, not kept. */
export function silenceAsking(store: SessionStore | null): void {
  try {
    store?.setItem(DRAW_LARGE_KEY, 'draw');
  } catch {
    // Not kept: the next large snapshot in this tab asks again.
  }
}
