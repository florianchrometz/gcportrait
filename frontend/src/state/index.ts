// SPDX-License-Identifier: MIT
/** The app state module: the store, its React bindings and the diagram page's hooks (frontend/README.md). */
export { AppStateProvider } from './AppStateProvider';
export {
  selectDrawnDay,
  selectScope,
  selectSceneKey,
  useAppState,
  useAppStore,
  useDiagramActions,
  useDiagramPipeline,
  useLayout,
  usePopover,
  useSheet,
  useScene,
  useSelection,
  useUi,
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
