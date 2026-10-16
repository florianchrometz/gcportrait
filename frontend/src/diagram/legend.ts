// SPDX-License-Identifier: MIT
/**
 * The legend (skill gcp-diagram-style §7): inside the SVG, bottom-left, a `surface` panel with a
 * `border` stroke, with rows only for what is on screen: the zone tints present, a "Resource" card sample when
 * cards are drawn, a chip sample when zones are collapsed (in the tint most of the drawn chips have, as chips
 * take their zone's tint), each relation kind drawn, the `secures` overlay named by its policy, and
 * "dim = not focused" when dim mode is on. While a node is selected, a column of its own explains the
 * selection trace ("selected", "trace", "path to root"). A timeline day compared with the day on screen
 * before it adds a row for each of its markers drawn ("added since 2026-09-07", "removed …", "changed …").
 */
import { DEFAULT_SIZING, measureText } from '@gcportrait/layout';
import { RELATION_KIND_IDS, RELATION_KINDS, type RelationKind } from '@gcportrait/model';

import { markerLabel, sincePhrase } from './diff/words';
import { fitText } from './geometry/text';
import type { DiagramModel } from './model';
import { zoneTintOf } from './theme/styles';
import { ZONE_TINTS, type ZoneTint } from './theme/tokens';

export type LegendRow =
  | { readonly type: 'zone'; readonly tint: ZoneTint; readonly label: string }
  | { readonly type: 'resource'; readonly label: string }
  | { readonly type: 'chip'; readonly tint: ZoneTint; readonly label: string }
  | { readonly type: 'relation'; readonly kind: RelationKind; readonly label: string }
  /** `title`: the full label when `label` was cut to `LEGEND_LABEL_MAX` (shown as the row's tooltip). */
  | { readonly type: 'overlay'; readonly label: string; readonly title?: string }
  | { readonly type: 'dim'; readonly label: string }
  | DiffLegendRow
  | TraceLegendRow;

/** A timeline marker's row (skill §6): the added outline, the removed ghost, the changed dot. */
export type DiffLegendRow =
  | { readonly type: 'added'; readonly label: string }
  | { readonly type: 'removed'; readonly label: string }
  | { readonly type: 'changed'; readonly label: string };

/** The selection trace's rows (skill §6): the selected node, the traced lines, the path to the root. */
export type TraceLegendRow =
  | { readonly type: 'selected'; readonly label: string }
  | { readonly type: 'trace'; readonly label: string }
  | { readonly type: 'path'; readonly label: string };

/** The trace column's rows, shown while a node is selected. */
export const TRACE_LEGEND_ROWS: readonly TraceLegendRow[] = [
  { type: 'selected', label: 'selected' },
  { type: 'trace', label: 'trace' },
  { type: 'path', label: 'path to root' },
];

const TINT_LABELS: Readonly<Record<Exclude<ZoneTint, 'other'>, string>> = {
  folder: 'Folder',
  project: 'Project',
  vpc: 'VPC network',
  subnet: 'Subnetwork',
  region: 'Region or zone (virtual)',
  nested: 'Nested container',
};

/** What a relation kind means, in a few words: the model's `meaning` up to its first example or colon. */
export function relationLabel(kind: RelationKind): string {
  const meaning = RELATION_KINDS[kind].meaning;
  const cut = meaning.search(/ \(|:/);
  return `${kind} — ${cut < 0 ? meaning : meaning.slice(0, cut)}`;
}

/** A `secures` source as the legend and the overlay titles name it: its label, or the chip that holds it. */
function policyName(model: DiagramModel, id: string): string {
  const label = model.nodes.get(id)?.label ?? id;
  return model.input.layout.rects[id]?.role === 'chip' ? `policies in ${label}` : label;
}

/**
 * What a set of `secures` sources is called (skill §5): one source by its name ("secures — web-armor"),
 * several by their number ("secures — 3 policies").
 */
export function securesLabel(model: DiagramModel, sources: readonly string[]): string {
  const distinct = [...new Set(sources)].sort();
  const [only] = distinct;
  if (distinct.length === 1 && only !== undefined) return `secures — ${policyName(model, only)}`;
  return `secures — ${String(distinct.length)} policies`;
}

/**
 * The sources of every `secures` overlay drawn: the policies' nodes, and a perimeter focus's overlay zones, a
 * timeline day's ghost of one included.
 */
export function securesSources(model: DiagramModel): string[] {
  return [
    ...model.overlayEdges.map((edge) => edge.path.from),
    ...model.overlayZones,
    ...(model.diff?.overlays ?? []),
  ];
}

/** The rows of a timeline day's markers drawn, naming the day compared with at the viewer's offset. */
export function diffLegendRows(model: DiagramModel, utcOffsetMinutes: number): DiffLegendRow[] {
  const { diff } = model;
  if (diff === null) return [];
  const since = sincePhrase(diff.since, diff.forward, utcOffsetMinutes);
  const rows: DiffLegendRow[] = [];
  if (diff.added.length > 0) rows.push({ type: 'added', label: markerLabel('added', since) });
  if (model.ghosts.length > 0) rows.push({ type: 'removed', label: markerLabel('removed', since) });
  if (diff.changed.length > 0) rows.push({ type: 'changed', label: markerLabel('changed', since) });
  return rows;
}

/** The legend's rows for what the model draws, in a fixed order. */
export function composeLegend(model: DiagramModel, utcOffsetMinutes = 0): LegendRow[] {
  const tints = new Set<ZoneTint>();
  let products = false;
  let groups = false;
  let cards = false;
  let chips = false;
  const chipTints = new Map<ZoneTint, number>();
  for (const [id, rect] of model.rects) {
    if (rect.kind === 'card') {
      cards = true;
      continue;
    }
    if (rect.role === 'chip') chips = true;
    if (model.overlayZones.has(id)) continue;
    const tint = zoneTintOf(rect.kind, rect.depth);
    tints.add(tint);
    if (rect.role === 'chip') chipTints.set(tint, (chipTints.get(tint) ?? 0) + 1);
    if (tint === 'other') {
      if (rect.kind === 'group') groups = true;
      else products = true;
    }
  }
  const rows: LegendRow[] = [];
  for (const tint of ZONE_TINTS) {
    if (!tints.has(tint)) continue;
    const label =
      tint === 'other'
        ? products && groups
          ? 'Container or group'
          : groups
            ? 'Group'
            : 'Product container'
        : TINT_LABELS[tint];
    rows.push({ type: 'zone', tint, label });
  }
  if (cards) rows.push({ type: 'resource', label: 'Resource' });
  if (chips) {
    // The most common chip tint; ties go to the outer kind (ZONE_TINTS order). Only overlay chips: neutral.
    let tint: ZoneTint = 'other';
    let most = 0;
    for (const candidate of ZONE_TINTS) {
      const count = chipTints.get(candidate) ?? 0;
      if (count > most) {
        tint = candidate;
        most = count;
      }
    }
    rows.push({ type: 'chip', tint, label: 'Collapsed zone' });
  }
  const kinds = new Set(model.lines.map((edge) => edge.path.kind));
  for (const kind of RELATION_KIND_IDS) {
    if (kinds.has(kind)) rows.push({ type: 'relation', kind, label: relationLabel(kind) });
  }
  const secures = securesSources(model);
  if (secures.length > 0) {
    // A policy's name can be long; the row is cut at a card's widest and keeps the full name as its tooltip.
    const full = securesLabel(model, secures);
    const label = fitText(full, 400, LEGEND.fontSize, LEGEND_LABEL_MAX);
    rows.push(label === full ? { type: 'overlay', label } : { type: 'overlay', label, title: full });
  }
  if (model.dim) rows.push({ type: 'dim', label: 'dim = not focused' });
  rows.push(...diffLegendRows(model, utcOffsetMinutes));
  return rows;
}

export const LEGEND_TITLE = 'Legend';

/** The widest a legend label may be (a card's widest, `cardMaxWidth`); a longer `secures` row is cut. */
export const LEGEND_LABEL_MAX = DEFAULT_SIZING.cardMaxWidth;

/** Legend metrics (px at scale 1); text is 11 px (skill §3). */
export const LEGEND = Object.freeze({
  fontSize: 11,
  padding: 12,
  titleHeight: 20,
  rowHeight: 20,
  swatchWidth: 36,
  swatchGap: 8,
  columnGap: 24,
  rowsPerColumn: 6,
});

export interface PlacedLegendRow {
  readonly row: LegendRow;
  /** Top-left of the row inside the panel. */
  readonly x: number;
  readonly y: number;
}

export interface LegendLayout {
  readonly rows: readonly PlacedLegendRow[];
  /** The panel without the trace column. */
  readonly width: number;
  readonly height: number;
  /** The trace column's rows, placed to the right of the others, and the panel's size with them. */
  readonly trace: {
    readonly rows: readonly PlacedLegendRow[];
    readonly width: number;
    readonly height: number;
  } | null;
}

function panelHeight(rows: number): number {
  const { padding, titleHeight, rowHeight, rowsPerColumn } = LEGEND;
  return padding + titleHeight + Math.min(rows, rowsPerColumn) * rowHeight + padding - 4;
}

/**
 * Rows in columns of at most `rowsPerColumn`, each column as wide as its widest label; deterministic. The trace
 * rows, when given, form one more column to the right, so showing them (a selection) only widens the panel.
 */
export function placeLegend(
  rows: readonly LegendRow[],
  traceRows: readonly TraceLegendRow[] = [],
): LegendLayout {
  const { padding, titleHeight, rowHeight, swatchWidth, swatchGap, columnGap, rowsPerColumn, fontSize } =
    LEGEND;
  const place = (list: readonly LegendRow[], left: number): { placed: PlacedLegendRow[]; right: number } => {
    const placed: PlacedLegendRow[] = [];
    let x = left;
    let right = left;
    for (let start = 0; start < list.length; start += rowsPerColumn) {
      const column = list.slice(start, start + rowsPerColumn);
      const labelWidth = Math.max(...column.map((row) => measureText(row.label, 400, fontSize)));
      column.forEach((row, index) => {
        placed.push({ row, x, y: padding + titleHeight + index * rowHeight });
      });
      right = Math.max(right, x + Math.ceil(swatchWidth + swatchGap + labelWidth));
      x = right + columnGap;
    }
    return { placed, right };
  };
  const base = place(rows, padding);
  const right = Math.max(base.right, padding + measureText(LEGEND_TITLE, 700, fontSize));
  const layout = { rows: base.placed, width: Math.ceil(right + padding), height: panelHeight(rows.length) };
  if (traceRows.length === 0) return { ...layout, trace: null };
  const trace = place(traceRows, rows.length === 0 ? padding : right + columnGap);
  return {
    ...layout,
    trace: {
      rows: trace.placed,
      width: Math.ceil(Math.max(right, trace.right) + padding),
      height: panelHeight(Math.max(rows.length, traceRows.length)),
    },
  };
}
