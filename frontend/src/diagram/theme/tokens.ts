// SPDX-License-Identifier: MIT
/**
 * Diagram colour tokens (skill gcp-diagram-style §2) in both themes. This table is what the renderer writes into
 * the SVG as presentation attributes (so a serialised SVG carries its theme's colours, for the snapshot
 * baselines, the headless renderer and the export), and `tokens.css` defines the same values as CSS custom
 * properties (`--dg-*`) that the interactive states use and that follow `<html data-theme>`.
 *
 * Every value is the skill's §2 value: §2 holds the grey outlines and the dim edge (each theme's `muted`), the dark
 * subnet stroke and the `mutedOnTint` and `pathCasing` tokens, each with its contrast figure (§10). Should a §2
 * value ever fail a §10 contrast pair, the
 * skill's own rule applies (§1: "keep Google's colour semantics and adjust values until contrast passes"),
 * with a colour the palette already has, listed in `SKILL_DEPARTURES` with the §2 value and its measured ratio
 * until the skill adopts it. `theme.test.ts` checks the table against the skill's §2 tables, checks that each
 * departure is still needed (the §2 value fails) and that every §10 pair passes.
 *
 * Values the skill's dark table leaves out are derived without a new colour: the dark `edge` and `chip.text`
 * are the dark `ink` (its row says "text, strokes, edges").
 */

export type DiagramTheme = 'light' | 'dark';

/** How a zone is tinted: its zone kind, with product containers split by depth (`nested` at depth ≥ 3). */
export type ZoneTint = 'folder' | 'project' | 'vpc' | 'subnet' | 'nested' | 'other' | 'region';

export interface ZonePaint {
  /** `none` for the virtual region zone, which is a dashed outline only. */
  readonly fill: string;
  readonly stroke: string;
}

export interface DiagramPalette {
  readonly canvas: string;
  readonly ink: string;
  readonly muted: string;
  readonly border: string;
  readonly surface: string;
  readonly zone: Readonly<Record<ZoneTint, ZonePaint>>;
  readonly card: ZonePaint;
  readonly edge: string;
  readonly edgeDim: string;
  readonly accentSelect: string;
  readonly accentPath: string;
  readonly accentPeer: string;
  readonly accentRemoved: string;
  readonly chipText: string;
  /**
   * The canvas's focus colour: its focus ring (2 px between canvas gaps, skill §9) and the focused console action
   * and collapse plate. Dark: the chrome's `primary`. Light: Google Blue 800 #185ABC, a step darker than the
   * chrome's `primary` #1A73E8, which reaches only 2.62 : 1 against the light project tint a focused card's ring
   * often lies on; #185ABC reaches 3.78 there and at least that on every other fill, so the focused and unfocused
   * pixels differ by 3 : 1 wherever the ring is drawn (skill §9).
   */
  readonly focus: string;
  /**
   * Secondary text (a zone's id after the middle dot, a card-sized zone's subtitle) on the mid-tone tints where
   * `muted` is below 4.5 : 1 (light: the project tint, 3.52; dark: the project and nested tints, 4.38 and 4.07):
   * the next grey of the palette towards `ink` (light `chip.text` #3C4043, dark `card` stroke #BDC1C6), so the
   * id still reads as secondary next to the title.
   */
  readonly mutedOnTint: string;
  /**
   * The band around the path-to-root accent and the `secures` overlay, as the canvas gap is around the selection
   * and focus rings (skill §9): a colour the accent reaches 3 : 1 against and that itself reaches 3 : 1 against
   * every zone fill it crosses. Light `muted` #5F6368 (the amber reaches only 1.1–1.9 : 1 on the light fills,
   * 3.13 : 1 on muted; muted reaches 3.52 : 1 on the project tint at worst; it replaced `ink`, whose
   * black-and-amber band read as hazard tape); dark `canvas` (as the rings; 11.75 : 1).
   */
  readonly pathCasing: string;
}

export const LIGHT_PALETTE: DiagramPalette = Object.freeze({
  canvas: '#FFFFFF',
  ink: '#202124',
  muted: '#5F6368',
  border: '#DADCE0',
  surface: '#F8F9FA',
  zone: Object.freeze({
    folder: { fill: '#F1F3F4', stroke: '#5F6368' },
    project: { fill: '#A8C7FA', stroke: '#202124' },
    vpc: { fill: '#CEEAD6', stroke: '#A8DAB5' },
    subnet: { fill: '#FFEEBD', stroke: '#FDE293' },
    nested: { fill: '#D2E3FC', stroke: '#5F6368' },
    other: { fill: '#F8F9FA', stroke: '#5F6368' },
    region: { fill: 'none', stroke: '#5F6368' },
  }),
  card: { fill: '#FFFFFF', stroke: '#202124' },
  edge: '#202124',
  edgeDim: '#5F6368',
  accentSelect: '#1A73E8',
  accentPath: '#F9AB00',
  accentPeer: '#188038',
  accentRemoved: '#D93025',
  chipText: '#3C4043',
  focus: '#185ABC',
  mutedOnTint: '#3C4043',
  pathCasing: '#5F6368',
});

export const DARK_PALETTE: DiagramPalette = Object.freeze({
  canvas: '#1F1F1F',
  ink: '#E8EAED',
  muted: '#9AA0A6',
  border: '#5F6368',
  surface: '#303134',
  zone: Object.freeze({
    folder: { fill: '#2A2B2E', stroke: '#9AA0A6' },
    project: { fill: '#1C3A5E', stroke: '#8AB4F8' },
    vpc: { fill: '#1E3A2A', stroke: '#81C995' },
    subnet: { fill: '#3D3419', stroke: '#B39B4C' },
    nested: { fill: '#2D3F55', stroke: '#9AA0A6' },
    other: { fill: '#303134', stroke: '#9AA0A6' },
    region: { fill: 'none', stroke: '#9AA0A6' },
  }),
  card: { fill: '#2B2C2F', stroke: '#BDC1C6' },
  edge: '#E8EAED',
  edgeDim: '#9AA0A6',
  accentSelect: '#8AB4F8',
  accentPath: '#FDD663',
  accentPeer: '#81C995',
  accentRemoved: '#F28B82',
  chipText: '#E8EAED',
  focus: '#8AB4F8',
  mutedOnTint: '#BDC1C6',
  pathCasing: '#1F1F1F',
});

/** A skill token whose §2 value this table does not use, and why (see the file comment). */
export interface SkillDeparture {
  readonly theme: DiagramTheme;
  /** The skill's token name; `part` says which of a fill / stroke pair. */
  readonly token: string;
  readonly part?: 'stroke';
  /** The §2 value (for the dark `zone.region`, which §2 leaves out: the value it would derive, `border`). */
  readonly skill: string;
  readonly value: string;
  /** The §10 pair the §2 value fails, with its measured ratio. */
  readonly fails: string;
}

/**
 * The departures from §2: none. The grey container outlines and the dim edge are each theme's `muted` grey, the
 * one grey of the palette that reaches 3 : 1 on every tint they meet (light #5F6368, 3.52 on the project tint at
 * worst; dark #9AA0A6, 4.07 on the nested tint at worst). `theme.test.ts` keeps the fainter greys they could take
 * instead (`FAINTER`) and shows that each of them fails a §10 pair.
 */
export const SKILL_DEPARTURES: readonly SkillDeparture[] = [];

export const PALETTES: Readonly<Record<DiagramTheme, DiagramPalette>> = Object.freeze({
  light: LIGHT_PALETTE,
  dark: DARK_PALETTE,
});

/**
 * The light plate behind Google's colour and grey marks on dark canvases (skill §2, "Rules for dark"): white at
 * 92 % opacity, radius 4, 2 px around the 24 px icon. Two-tone icons and the own drawings need none.
 */
export const ICON_PLATE = Object.freeze({ fill: '#FFFFFF', opacity: 0.92, radius: 4, inset: 2 });

/** Every tint in a fixed order (legend rows, CSS variables, tests). */
export const ZONE_TINTS: readonly ZoneTint[] = [
  'folder',
  'project',
  'vpc',
  'subnet',
  'region',
  'other',
  'nested',
];

/**
 * The CSS custom properties `tokens.css` must define for a palette, name → value. The renderer's interactive
 * states (ancestor path, selection, focus, dim, casing) read these, so they follow the app theme.
 */
export function cssVariables(palette: DiagramPalette): ReadonlyArray<readonly [string, string]> {
  const zones = ZONE_TINTS.flatMap((tint) => {
    const paint = palette.zone[tint];
    return [
      [`--dg-zone-${tint}-fill`, paint.fill],
      [`--dg-zone-${tint}-stroke`, paint.stroke],
    ] as const;
  });
  return [
    ['--dg-canvas', palette.canvas],
    ['--dg-ink', palette.ink],
    ['--dg-muted', palette.muted],
    ['--dg-border', palette.border],
    ['--dg-surface', palette.surface],
    ...zones,
    ['--dg-card-fill', palette.card.fill],
    ['--dg-card-stroke', palette.card.stroke],
    ['--dg-edge', palette.edge],
    ['--dg-edge-dim', palette.edgeDim],
    ['--dg-accent-select', palette.accentSelect],
    ['--dg-accent-path', palette.accentPath],
    ['--dg-accent-peer', palette.accentPeer],
    ['--dg-accent-removed', palette.accentRemoved],
    ['--dg-chip-text', palette.chipText],
    ['--dg-focus', palette.focus],
    ['--dg-muted-on-tint', palette.mutedOnTint],
    ['--dg-path-casing', palette.pathCasing],
  ];
}
