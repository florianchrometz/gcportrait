// SPDX-License-Identifier: Apache-2.0
/**
 * Saved views (IndexedDB for snapshots, saved views and preferences; frontend/AGENTS.md, Code): a name and
 * the view's URL hash, kept in the `savedViews` store of the browser database (storage/db.ts, `StoredView`), so a
 * saved view reopens exactly as its link would. Nothing leaves the browser. When IndexedDB is unavailable (some
 * private windows, tests without it) the views are kept in memory for the session and every write says so
 * (`persisted: false`), as the preference store does.
 *
 * Saving under a name that is already taken (ignoring case and surrounding spaces) updates that view rather than
 * adding a second one of the same name. The list is newest first (`updatedAt`, then name).
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import {
  databaseOf,
  useDatabaseConnection,
  type DatabaseConnection,
  type DatabaseSource,
} from '../storage/connection';
import type { GcportraitDB, StoredView } from '../storage/db';

/** The longest name kept (longer names are cut). */
export const MAX_VIEW_NAME = 80;

export interface SaveResult {
  readonly view: StoredView;
  /** An existing view of that name was updated. */
  readonly replaced: boolean;
  /** The write reached IndexedDB (false: kept in memory for this session only). */
  readonly persisted: boolean;
}

export interface SavedViewStore {
  list(): Promise<StoredView[]>;
  save(name: string, viewSpecHash: string): Promise<SaveResult>;
  /** Renames a view; null when there is no such view. */
  rename(id: string, name: string): Promise<StoredView | null>;
  remove(id: string): Promise<void>;
  /** Called after every change (from any component). */
  subscribe(listener: () => void): () => void;
}

export interface SavedViewStoreOptions {
  readonly now?: () => Date;
  readonly newId?: () => string;
}

const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** A name as stored: trimmed, inner runs of white space as one space, at most MAX_VIEW_NAME characters. */
export function cleanViewName(name: string): string {
  const text = name.trim().replace(/\s+/g, ' ');
  return Array.from(GRAPHEMES.segment(text), (part) => part.segment)
    .slice(0, MAX_VIEW_NAME)
    .join('');
}

function sameName(a: string, b: string): boolean {
  return cleanViewName(a).toLowerCase() === cleanViewName(b).toLowerCase();
}

function newestFirst(a: StoredView, b: StoredView): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return a.name.localeCompare(b.name);
}

function randomId(): string {
  const crypto = globalThis.crypto as Crypto | undefined;
  if (crypto !== undefined && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A store over a database that may still be opening, or may never open (null). */
export function createSavedViewStore(
  source: DatabaseSource,
  options: SavedViewStoreOptions = {},
): SavedViewStore {
  const database = databaseOf(source);
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomId;
  const memory = new Map<string, StoredView>();
  const listeners = new Set<() => void>();
  const changed = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const readAll = async (): Promise<{ views: StoredView[]; db: GcportraitDB | null }> => {
    const db = await database();
    if (db === null) return { views: [...memory.values()], db };
    try {
      return { views: await db.getAll('savedViews'), db };
    } catch {
      return { views: [...memory.values()], db: null };
    }
  };

  const write = async (db: GcportraitDB | null, view: StoredView): Promise<boolean> => {
    memory.set(view.id, view);
    if (db === null) return false;
    try {
      await db.put('savedViews', view);
      return true;
    } catch {
      return false;
    }
  };

  return {
    async list() {
      const { views } = await readAll();
      return views.sort(newestFirst);
    },
    async save(name, viewSpecHash) {
      const clean = cleanViewName(name);
      if (clean === '') throw new Error('A saved view needs a name.');
      const { views, db } = await readAll();
      const existing = views.find((view) => sameName(view.name, clean));
      const at = now().toISOString();
      const view: StoredView =
        existing === undefined
          ? { id: newId(), name: clean, viewSpecHash, createdAt: at, updatedAt: at }
          : { ...existing, name: clean, viewSpecHash, updatedAt: at };
      const persisted = await write(db, view);
      changed();
      return { view, replaced: existing !== undefined, persisted };
    },
    async rename(id, name) {
      const clean = cleanViewName(name);
      if (clean === '') throw new Error('A saved view needs a name.');
      const { views, db } = await readAll();
      const existing = views.find((view) => view.id === id);
      if (existing === undefined) return null;
      const view: StoredView = { ...existing, name: clean, updatedAt: now().toISOString() };
      await write(db, view);
      changed();
      return view;
    },
    async remove(id) {
      memory.delete(id);
      const db = await database();
      if (db !== null) {
        try {
          await db.delete('savedViews', id);
        } catch {
          // Kept in the database; the next list shows it again.
        }
      }
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** One store per connection: every component that lists or saves views shares it, and its listeners. */
const STORES = new WeakMap<DatabaseConnection, SavedViewStore>();

/** The app's store: over the page's IndexedDB connection (storage/connection.ts, shared with the other stores). */
export function savedViewStoreOf(connection: DatabaseConnection): SavedViewStore {
  let store = STORES.get(connection);
  if (store === undefined) {
    store = createSavedViewStore(connection.database);
    STORES.set(connection, store);
  }
  return store;
}

/** The saved-view store; tests give their own. Null: the one over the app's connection. */
export const SavedViewStoreContext = createContext<SavedViewStore | null>(null);

export function useSavedViewStore(): SavedViewStore {
  const given = useContext(SavedViewStoreContext);
  const connection = useDatabaseConnection();
  return given ?? savedViewStoreOf(connection);
}

/** The saved views, newest first, kept current; null until first read. */
export function useSavedViews(active = true): readonly StoredView[] | null {
  const store = useSavedViewStore();
  const [views, setViews] = useState<readonly StoredView[] | null>(null);
  const refresh = useCallback(() => {
    let live = true;
    void store.list().then(
      (next) => {
        if (live) setViews(next);
      },
      () => {
        if (live) setViews([]);
      },
    );
    return () => {
      live = false;
    };
  }, [store]);

  useEffect(() => {
    if (!active) return undefined;
    let cancel = refresh();
    const unsubscribe = store.subscribe(() => {
      cancel();
      cancel = refresh();
    });
    return () => {
      cancel();
      unsubscribe();
    };
  }, [store, refresh, active]);

  return views;
}
