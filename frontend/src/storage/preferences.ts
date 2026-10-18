// SPDX-License-Identifier: Apache-2.0
import { createContext, useCallback, useContext, useEffect, useState } from 'react';

import { parseQuotaProjects, parseRecentScopes } from '../scope/recent';
import type { ScopeChoice } from '../scope/scopeName';
import { isThemePreference, type ThemePreference } from '../theme/theme';
import { databaseOf, type DatabaseSource } from './connection';

/**
 * Typed access to the `preferences` store. Values are validated on every read, so a stale or hand-edited
 * entry is ignored instead of breaking the app. When IndexedDB is unavailable the store keeps values in
 * memory for the session and reports writes as not persisted.
 */

export type Preferences = {
  readonly theme: ThemePreference;
  /** Show the legend and the title block on the interactive diagram canvas (exports always carry them). */
  readonly diagramOverlays: boolean;
  /** The details drawer's width in CSS px (360–420, resized by its handle). */
  readonly drawerWidth: number;
  /** The scope picker's recent scopes, newest first (scope/recent.ts). */
  readonly recentScopes: readonly ScopeChoice[];
  /** The quota project last picked per scope. */
  readonly quotaProjects: Readonly<Record<string, string>>;
};

/** The details drawer's width range (CSS px); a stored width outside it is clamped. */
export const DRAWER_WIDTH = Object.freeze({ min: 360, max: 420 });
export type PreferenceKey = keyof Preferences;

const PARSERS: { readonly [K in PreferenceKey]: (value: unknown) => Preferences[K] | undefined } = {
  theme: (value) => (isThemePreference(value) ? value : undefined),
  diagramOverlays: (value) => (typeof value === 'boolean' ? value : undefined),
  drawerWidth: (value) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.round(Math.min(DRAWER_WIDTH.max, Math.max(DRAWER_WIDTH.min, value)))
      : undefined,
  recentScopes: parseRecentScopes,
  quotaProjects: parseQuotaProjects,
};

export type PreferenceStore = {
  get<K extends PreferenceKey>(key: K): Promise<Preferences[K] | undefined>;
  /** Resolves to true when the value reached IndexedDB, false when it is kept in memory only. */
  set<K extends PreferenceKey>(key: K, value: Preferences[K]): Promise<boolean>;
};

/** A store over a database that may still be opening, or may never open (null). */
export function createPreferenceStore(source: DatabaseSource): PreferenceStore {
  const database = databaseOf(source);
  const memory = new Map<PreferenceKey, unknown>();
  const readMemory = <K extends PreferenceKey>(key: K): Preferences[K] | undefined =>
    PARSERS[key](memory.get(key));

  return {
    async get(key) {
      const db = await database();
      if (db === null) return readMemory(key);
      try {
        return PARSERS[key](await db.get('preferences', key)) ?? readMemory(key);
      } catch {
        return readMemory(key);
      }
    },
    async set(key, value) {
      memory.set(key, value);
      const db = await database();
      if (db === null) return false;
      try {
        await db.put('preferences', value, key);
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** A store that never persists; the context default, and handy in tests. */
export function createMemoryPreferenceStore(): PreferenceStore {
  return createPreferenceStore(Promise.resolve(null));
}

export const PreferenceStoreContext = createContext<PreferenceStore>(createMemoryPreferenceStore());

export function usePreferenceStore(): PreferenceStore {
  return useContext(PreferenceStoreContext);
}

/**
 * A preference as React state: `fallback` until the stored value has been read, then the stored value; the
 * setter updates the state at once and saves the value.
 */
export function usePreference<K extends PreferenceKey>(
  key: K,
  fallback: Preferences[K],
): readonly [Preferences[K], (value: Preferences[K]) => void] {
  const store = usePreferenceStore();
  const [value, setValue] = useState<Preferences[K]>(fallback);
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (touched) return undefined;
    let live = true;
    void store.get(key).then((stored) => {
      if (live && stored !== undefined) setValue(stored);
    });
    return () => {
      live = false;
    };
  }, [store, key, touched]);
  const update = useCallback(
    (next: Preferences[K]): void => {
      setTouched(true);
      setValue(next);
      void store.set(key, next);
    },
    [store, key],
  );
  return [value, update] as const;
}
