// SPDX-License-Identifier: MIT
/**
 * Progressive disclosure on the page (frontend/README.md "Progressive disclosure"): the flip and
 * level logic behind "Expand all" and "Collapse all" (flips.ts, used by the store's actions), the selectors and
 * the notices over the app store (state.ts), the canvas's collapse affordance (CollapseButton.tsx), the camera
 * after a flip (flipCamera.ts) and the bar with "N of M shown" (DisclosureBar.tsx).
 */
export {
  COLLAPSE_CLASS,
  COLLAPSE_ZONE_ATTRIBUTE,
  CollapseButton,
  collapseButtonOf,
  collapseZoneOf,
} from './CollapseButton';
export { DisclosureBar, shownText } from './DisclosureBar';
export {
  autoLevelShift,
  collapseAllView,
  collapsedByDefault,
  expandAllView,
  flipsDroppedByCap,
  LEVEL_NAMES,
  nextOpeningLevel,
  rectsShown,
  zonesByFlip,
  type AutoLevelShift,
  type ShownScene,
  type ZoneState,
} from './flips';
export { FLIP_GLIDE_MS, flipTransform, isFlipDrawn, type PendingFlip } from './flipCamera';
export {
  selectCanCollapseAll,
  selectCanExpandAll,
  selectExpandLevelName,
  selectRectsShown,
  selectRectsTotal,
  selectUsedLevelName,
  useDisclosureNotice,
} from './state';
