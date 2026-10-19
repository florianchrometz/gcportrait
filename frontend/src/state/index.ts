// SPDX-License-Identifier: Apache-2.0
/** The app state module: the store, its React bindings and the diagram page's hooks (frontend/README.md). */
export { AppStateProvider } from './AppStateProvider';
export {
  selectDrawnDay,
  selectDrawnReadTime,
  selectLoadedSnapshot,
  selectScope,
  selectSceneKey,
  useAppState,
  useAppStore,
  useDiagramActions,
  useDiagramPipeline,
  usePopover,
  useSheet,
  useScene,
  useView,
} from './hooks';
export { FALLBACK_VIEWPORT, locateViewport, sceneKey } from './pipeline';
export type * from './slices';
export {
  createAppStore,
  DEMO_SNAPSHOTS,
  type AppStore,
  type HashNavigator,
  type HashTarget,
  type StoreOptions,
  type ViewActions,
  type WriteOptions,
} from './store';
