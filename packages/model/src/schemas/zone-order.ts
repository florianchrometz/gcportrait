// SPDX-License-Identifier: MIT
/**
 * The sibling order of zone kinds (skill gcp-diagram-layout §4: zones before cards, then by kind rank with the
 * VPC before other containers, then by label, then by id), declared once for the two packages that sort
 * siblings: `packages/graph` orders the Scene by it and `packages/layout` sorts every child list by it again,
 * so a hand-built Scene in any order lays out the same. Folders rank before projects, so the canvas packs
 * folders first and loose projects after them.
 */
import type { ZoneKind } from './scene.js';

export const ZONE_KIND_RANK: Readonly<Record<ZoneKind, number>> = Object.freeze({
  folder: 0,
  project: 1,
  vpc: 2,
  subnet: 3,
  region: 4,
  'product-container': 5,
  group: 6,
});
