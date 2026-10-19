// SPDX-License-Identifier: Apache-2.0
import { Route, Routes } from './router';

import { AuthProvider } from './auth/AuthProvider';
import type { DiagramWorkersFactory } from './diagram/pipeline/workers';
import { DiagramSessionProvider } from './diagram/session';
import { LegalPage } from './legal/LegalPage';
import { AppModeContext, type AppMode } from './mode';
import { ConnectPage } from './pages/ConnectPage';
import { DiagramPage } from './pages/DiagramPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { PermissionsPage } from './pages/PermissionsPage';
import { SettingsPage } from './pages/SettingsPage';
import { SnapshotsPage } from './pages/SnapshotsPage';
import { AppShell } from './shell/AppShell';
import { LargeSnapshotGuardProvider } from './snapshots/LargeSnapshotGuard';
import type { SnapshotLibrary } from './snapshots/library';
import { SnapshotLibraryProvider } from './snapshots/SnapshotLibraryProvider';
import { AppStateProvider } from './state';
import { DatabaseContext, type DatabaseConnection } from './storage/connection';
import { PreferenceStoreContext, type PreferenceStore } from './storage/preferences';
import { ThemeProvider } from './theme/ThemeProvider';

export type AppProps = {
  readonly mode: AppMode;
  /**
   * The page's IndexedDB connection (main.tsx; storage/connection.ts), which the saved views read through, as the
   * preferences and the snapshot library given here do; tests may leave it out.
   */
  readonly database?: DatabaseConnection | undefined;
  readonly preferences: PreferenceStore;
  /**
   * Creates the diagram's data and layout workers, on first use (main.tsx: the real Web Workers; tests: an
   * in-process pair, or none).
   */
  readonly diagramWorkers?: DiagramWorkersFactory | undefined;
  /**
   * The snapshot library (main.tsx: IndexedDB, the snapshot worker and the data worker's demo job; tests:
   * their own, or by default one that keeps nothing and cannot generate).
   */
  readonly snapshots?: SnapshotLibrary | undefined;
};

/**
 * The application: providers and routes (router.tsx, declarative mode). The router itself is supplied
 * by the caller: BrowserRouter in main.tsx, MemoryRouter in tests. The app store (src/state) sits inside it,
 * bound to its location; the sign-in (src/auth) inside the store, whose `connect` slice it fills; the
 * large-snapshot guard (snapshots/LargeSnapshotGuard.tsx) inside the snapshot library, whose listing it reads.
 */
export function App({ mode, database, preferences, diagramWorkers, snapshots }: AppProps) {
  return (
    <AppModeContext value={mode}>
      <DatabaseContext value={database ?? null}>
        <PreferenceStoreContext value={preferences}>
          <ThemeProvider>
            <DiagramSessionProvider factory={diagramWorkers}>
              <AppStateProvider>
                <AuthProvider>
                  <SnapshotLibraryProvider library={snapshots}>
                    <LargeSnapshotGuardProvider>
                      <Routes>
                        <Route element={<AppShell />}>
                          <Route index element={<ConnectPage />} />
                          <Route path="diagram" element={<DiagramPage />} />
                          <Route path="snapshots" element={<SnapshotsPage />} />
                          <Route path="permissions" element={<PermissionsPage />} />
                          <Route path="settings" element={<SettingsPage />} />
                          <Route path="impressum" element={<LegalPage id="impressum" />} />
                          <Route path="privacy" element={<LegalPage id="privacy" />} />
                          <Route path="*" element={<NotFoundPage />} />
                        </Route>
                      </Routes>
                    </LargeSnapshotGuardProvider>
                  </SnapshotLibraryProvider>
                </AuthProvider>
              </AppStateProvider>
            </DiagramSessionProvider>
          </ThemeProvider>
        </PreferenceStoreContext>
      </DatabaseContext>
    </AppModeContext>
  );
}
