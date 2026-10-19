// SPDX-License-Identifier: Apache-2.0
/**
 * Level of detail by effective scale (skill gcp-diagram-style §3 and §5): subtitles hide below 0.55,
 * labels below 0.35 (icons stay), and edge strokes thin to 1.5 px past 2×. The canvas applies a level by
 * setting classes on its `<svg>`; nothing is re-rendered and nothing is laid out again.
 */

export const SUBTITLE_MIN_SCALE = 0.55;
export const LABEL_MIN_SCALE = 0.35;
export const THIN_ABOVE_SCALE = 2;

export interface LevelOfDetail {
  readonly subtitles: boolean;
  readonly labels: boolean;
  readonly thinStrokes: boolean;
}

/** What is drawn at an effective scale (CSS px per diagram px). */
export function levelOfDetail(scale: number): LevelOfDetail {
  return {
    subtitles: scale >= SUBTITLE_MIN_SCALE,
    labels: scale >= LABEL_MIN_SCALE,
    thinStrokes: scale > THIN_ABOVE_SCALE,
  };
}

/** The `<svg>` classes of a level: `dg-lod-nosub`, `dg-lod-nolabel`, `dg-lod-thin` (diagram.css). */
export function lodClasses(lod: LevelOfDetail): readonly string[] {
  const classes: string[] = [];
  if (!lod.subtitles) classes.push('dg-lod-nosub');
  if (!lod.labels) classes.push('dg-lod-nolabel');
  if (lod.thinStrokes) classes.push('dg-lod-thin');
  return classes;
}

export const LOD_CLASSES = ['dg-lod-nosub', 'dg-lod-nolabel', 'dg-lod-thin'] as const;
