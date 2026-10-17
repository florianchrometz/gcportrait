// SPDX-License-Identifier: MIT
/**
 * The diagram as an SVG scene graph (skill gcp-diagram-style §2–§7): tinted zones with their
 * headers and badges, cards, chips and card-sized empty zones with their icons, `secures` overlays inside their
 * targets, routed edges with a marker per relation kind (dimmed lines keep 7 × 5 heads), the legend and the
 * title block. Pure: the same model and options always render the same markup, so the interactive canvas, the
 * snapshot baselines and the headless renderer draw the same picture. Colours are written as
 * presentation attributes from the theme's palette.
 *
 * The selection trace (skill §6) is drawn with the same elements in two ways: the interactive canvas
 * draws its scaffolding hidden (one traced line per relation kind as a prototype, `TracedPrototype`; the path
 * rings, the reach rings, the selection and focus rings, the console action, the legend's trace column) and the
 * highlight painter shows and places it by attributes and classes, and clones a prototype for each line it traces
 * (painter.ts; before, the canvas held a hidden traced copy of every line); a static drawing with `selection`
 * (the selected-state baselines) draws the trace of that node as it is.
 *
 * A timeline day's markers (skill §6; diff/marks.ts) are part of the drawing of that day, since its diff comes
 * with its Scene: the ghosts after the nodes, then the added outlines and the changed dots under the overlays and
 * the lines (so no line or head is hidden by their canvas gaps), and the legend's rows for them. Nothing paints
 * them later.
 */
import {
  DEFAULT_SIZING,
  TEXT_WEIGHTS,
  ZONE_TITLE_SEPARATOR,
  measureText,
  zoneTitleSizeAt,
} from '@gcportrait/layout';
import type { LayoutRect, Rect, TextRun } from '@gcportrait/layout';
import type { Icon } from '@gcportrait/icons';
import {
  RELATION_KINDS,
  RELATION_KIND_IDS,
  type ChipCounts,
  type RelationKind,
  type SceneNode,
} from '@gcportrait/model';
import { Fragment, type ReactElement, type ReactNode, type SVGProps } from 'react';

import { CONSOLE_LABELS } from './actions';
import { CollapseButton } from './disclosure/CollapseButton';
import { addedPathData, changedDotCentre, type DiffMarks } from './diff/marks';
import type { GhostReason } from './diff/types';
import { GHOST_LINE, ghostText, nameSuffix, sincePhrase } from './diff/words';
import { edgePathData, fmt } from './geometry/edgePath';
import { ringBox } from './geometry/rings';
import { iconKeyOf, lookupIcon, placeIconMarkup } from './icons';
import { fitSubtitle, fitText, runsWidth } from './geometry/text';
import {
  composeLegend,
  LEGEND,
  LEGEND_TITLE,
  placeLegend,
  securesLabel,
  TRACE_LEGEND_ROWS,
  type LegendLayout,
  type LegendRow,
  type PlacedLegendRow,
} from './legend';
import {
  consoleActionWidth,
  consoleGlyphPath,
  reachPathData,
  ringPlacement,
  SELECT_DISTANCE,
  type RingPlacement,
} from './marks';
import type { DiagramEdge, DiagramModel } from './model';
import { cardTypeName } from './names';
import { blendOver, readableOn } from './theme/contrast';
import {
  ADDED_WIDTH,
  CARD_RADIUS,
  CARD_STROKE_WIDTH,
  CASING,
  CHANGED_DOT_CASING,
  CHANGED_DOT_RADIUS,
  CONSOLE_ACTION,
  DIM_EDGE_WIDTH,
  dimHead,
  edgeStyleOf,
  FOCUS_WIDTH,
  GHOST_BAND,
  GHOST_DASH,
  GHOST_OPACITY,
  GHOST_STROKE_WIDTH,
  HALO,
  OVERLAY_DASH,
  OVERLAY_INSET,
  OVERLAY_OPACITY,
  OVERLAY_WIDTH,
  PATH_CASING,
  PATH_WIDTH,
  REACH_WIDTH,
  RING_GAP,
  SELECT_WIDTH,
  TRACE_WIDTH,
  traceDash,
  ZONE_KIND_NAMES,
  ZONE_RADIUS,
  zoneStroke,
  zoneTintOf,
  type EdgeStyle,
  type HeadStyle,
} from './theme/styles';
import { computeTrace, type Trace } from './trace';
import { ICON_PLATE, PALETTES, type DiagramPalette, type DiagramTheme } from './theme/tokens';
import { titleBlock, type TitleBlock, type TitleBlockLine } from './titleBlock';

/** Labels use the skill's §3 stack; ids and addresses Roboto Mono. Widths come from the Roboto metrics. */
export const SANS_STACK = "'Google Sans', 'Google Sans Text', Roboto, system-ui, sans-serif";
export const MONO_STACK = "'Roboto Mono', ui-monospace, monospace";

const SIZING = DEFAULT_SIZING;
const ICON = SIZING.cardIcon;
/** Space between the title block or the legend and the diagram's content (the layout's canvas margin). */
const MARGIN = SIZING.canvasMargin;

/** The layer of traced lines on top (`TracedEdges`), and the class of the interactive canvas's prototypes in it. */
export const TRACED_LAYER_CLASS = 'dg-edges-top';
export const TRACED_PROTOTYPE_CLASS = 'dg-edge-proto';

export interface DrawingOptions {
  readonly theme: DiagramTheme;
  /** Draw the legend and the title block (always in exports; a setting hides them on the canvas). */
  readonly overlays: boolean;
  /**
   * Keyboard and pointer scaffolding: roles, tab stops, focus and selection rings, focus copies of edges. A
   * static drawing (false) is a standalone file; its title block is the canvas's (no affiliation line in either).
   */
  readonly interactive: boolean;
  /** The viewer's UTC offset in minutes, for the read time in the title block. */
  readonly utcOffsetMinutes: number;
  /** Prefix of every id in the drawing (markers, icons); default `dg`. */
  readonly idPrefix?: string;
  /**
   * A static drawing only (the interactive canvas paints its selection with the painter): draw this node as
   * selected, with its trace and the legend's trace column (the selected-state baselines).
   */
  readonly selection?: string | null;
  /**
   * The interactive canvas only, when the page can flip zones: every open zone gets its collapse button
   * over its header icon (disclosure/CollapseButton.tsx).
   */
  readonly collapsible?: boolean;
}

export interface DrawingPlan {
  /** Everything drawn: the layout's canvas plus the title band above it and the legend below it. */
  readonly frame: Rect;
  readonly title: { readonly x: number; readonly y: number; readonly block: TitleBlock } | null;
  readonly legend: {
    readonly x: number;
    readonly y: number;
    readonly rows: readonly LegendRow[];
    readonly layout: LegendLayout;
  } | null;
  /** Every icon drawn, once, by key. */
  readonly icons: readonly Icon[];
  /** Relation kinds whose arrowhead marker (in `edge`) is defined. */
  readonly markers: readonly RelationKind[];
  /** Relation kinds whose dim-mode head marker (7 × 5 in `edge.dim`) is defined. */
  readonly dimMarkers: readonly RelationKind[];
  /** Relation kinds whose trace head marker (in `accent.select`) is defined. */
  readonly traceMarkers: readonly RelationKind[];
  /** The trace a static drawing shows (`DrawingOptions.selection`); null otherwise. */
  readonly trace: Trace | null;
  /** The legend's trace column is drawn: shown (a static selection) or hidden for the painter (interactive). */
  readonly traceLegend: boolean;
}

export { cardTypeName } from './names';

function iconOfNode(model: DiagramModel, id: string, rect: LayoutRect): Icon {
  return lookupIcon(model.input.icons, iconKeyOf(model.nodes.get(id), rect));
}

/** Where the title block, the diagram and the legend go, and which icons and markers the drawing needs. */
export function planDrawing(
  model: DiagramModel,
  options: Pick<DrawingOptions, 'overlays' | 'utcOffsetMinutes'> &
    Partial<Pick<DrawingOptions, 'interactive' | 'selection'>>,
): DrawingPlan {
  const { bounds } = model.input.layout;
  const interactive = options.interactive === true;
  const icons = new Map<string, Icon>();
  // Every node's icon: a card's, a zone's header mark, and a chip's (its zone's header mark); a ghost's too.
  for (const [id, rect] of [...model.rects, ...model.ghosts]) {
    const icon = iconOfNode(model, id, rect);
    icons.set(icon.key, icon);
  }
  const trace =
    interactive || options.selection === null || options.selection === undefined
      ? null
      : computeTrace(model.trace, options.selection);
  const headed = new Set<RelationKind>();
  const traced = new Set<RelationKind>();
  const tracedKeys = new Set(trace?.edges ?? []);
  for (const edge of model.lines) {
    if (edge.style.head === undefined || edge.path.heads === 'none') continue;
    headed.add(edge.path.kind);
    if (interactive || tracedKeys.has(edge.key)) traced.add(edge.path.kind);
  }
  const traceLegend = options.overlays && (interactive || trace !== null);
  // The legend's trace sample is a routes line with its head.
  if (traceLegend) traced.add('routes');
  const kinds = (set: ReadonlySet<RelationKind>): RelationKind[] =>
    RELATION_KIND_IDS.filter((kind) => set.has(kind));
  const markers = model.dim ? [] : kinds(headed);
  const dimMarkers = model.dim ? kinds(headed) : [];
  const traceMarkers = kinds(traced);
  const sortedIcons = [...icons.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const common = { icons: sortedIcons, markers, dimMarkers, traceMarkers, trace, traceLegend };
  if (!options.overlays) return { frame: bounds, title: null, legend: null, ...common };

  const { metadata } = model.input.scene;
  // The same title block on the canvas and in a standalone file (the export, the baselines, `pnpm render`): it
  // ends with the tagline, and the non-affiliation statement stays in the app footer (AGENTS.md,
  // Non-affiliation, brand and legal).
  const block = titleBlock(
    metadata.rootLabel,
    model.input.lensTitle,
    metadata.readTime,
    options.utcOffsetMinutes,
  );
  const rows = composeLegend(model, options.utcOffsetMinutes);
  const top = bounds.y - MARGIN - block.height;
  const title = { x: bounds.x + MARGIN, y: top + MARGIN, block };
  const titleWidth = Math.max(bounds.width, MARGIN + block.width + MARGIN);
  // Nothing drawn (an empty Scene), nothing to explain: no legend panel at all.
  if (rows.length === 0) {
    const bottom = bounds.y + bounds.height;
    return {
      frame: { x: bounds.x, y: top, width: titleWidth, height: bottom - top },
      title,
      legend: null,
      ...common,
      traceLegend: false,
    };
  }
  // The legend's sample rows need the markers of their kinds even when no line drew a head (they always do).
  // The frame makes room for the trace column whenever it can be shown, so a selection never moves the camera.
  const legendLayout = placeLegend(rows, traceLegend ? TRACE_LEGEND_ROWS : []);
  const legendWidth = legendLayout.trace?.width ?? legendLayout.width;
  const legendHeight = legendLayout.trace?.height ?? legendLayout.height;
  const legendY = bounds.y + bounds.height;
  const width = Math.max(titleWidth, MARGIN + legendWidth + MARGIN);
  return {
    frame: { x: bounds.x, y: top, width, height: legendY + legendHeight + MARGIN - top },
    title,
    legend: { x: bounds.x + MARGIN, y: legendY, rows, layout: legendLayout },
    ...common,
  };
}

const COUNT_NAMES: ReadonlyArray<readonly [keyof ChipCounts, string, string]> = [
  ['folders', 'folder', 'fld'],
  ['projects', 'project', 'prj'],
  ['networks', 'network', 'net'],
  ['subnets', 'subnet', 'sub'],
  ['containers', 'container', 'ctr'],
  ['resources', 'resource', 'res'],
];

/** "2 networks · 39 resources", or the short form "2 net · 39 res". */
export function chipCountLine(counts: ChipCounts, short = false): string {
  return COUNT_NAMES.flatMap(([key, singular, abbreviation]) => {
    const count = counts[key];
    if (count === undefined) return [];
    return [`${String(count)} ${short ? abbreviation : count === 1 ? singular : `${singular}s`}`];
  }).join(ZONE_TITLE_SEPARATOR);
}

/**
 * The accessible name of a rect (style skill §13: type + label). A zone is named by its asset type when the data
 * worker sent one (`zoneTypes`: "Compute Engine instance group manager: api-mig"), else by its kind.
 */
export function accessibleName(
  node: SceneNode | undefined,
  rect: LayoutRect,
  id: string,
  typeName?: string,
): string {
  if (node === undefined) return id;
  if (node.type === 'card') return `${cardTypeName(node.product, node.assetType)}: ${node.label}`;
  const kind = typeName ?? ZONE_KIND_NAMES[node.kind];
  const sub = node.subtitle === undefined ? '' : ` (${node.subtitle})`;
  if (rect.role === 'chip' && node.collapsed !== undefined) {
    // A ghost chip counts only what of it is gone, which can be nothing (diff/tickDiff.ts).
    const counts = chipCountLine(node.collapsed);
    return `${kind}: ${node.label}${sub}, collapsed${counts === '' ? '' : `, ${counts}`}`;
  }
  if (rect.role === 'empty') return `${kind}: ${node.label}${sub}, empty`;
  return `${kind}: ${node.label}${sub}`;
}

interface Context {
  readonly model: DiagramModel;
  readonly options: DrawingOptions;
  readonly palette: DiagramPalette;
  readonly prefix: string;
  /** The colour behind each rect (its own tint, or its parent's when it has none). */
  readonly background: ReadonlyMap<string, string>;
  /** A static drawing's trace (`DrawingOptions.selection`), and its lines; null and empty otherwise. */
  readonly trace: Trace | null;
  readonly traced: ReadonlySet<string>;
  /** Each rect's short index (its place in `model.rects`), the `data-n` the markers name it by. */
  readonly index: ReadonlyMap<string, number>;
}

function backgrounds(model: DiagramModel, palette: DiagramPalette): Map<string, string> {
  const map = new Map<string, string>();
  for (const [id, rect] of model.rects) {
    const behind = rect.parent === null ? palette.canvas : (map.get(rect.parent) ?? palette.canvas);
    if (rect.kind === 'card') {
      map.set(id, palette.card.fill);
      continue;
    }
    const fill = model.overlayZones.has(id) ? 'none' : palette.zone[zoneTintOf(rect.kind, rect.depth)].fill;
    map.set(id, fill === 'none' ? behind : fill);
  }
  return map;
}

function iconId(prefix: string, icon: Icon): string {
  return `${prefix}-icon-${icon.key}`;
}

type MarkerEnd = 'start' | 'end';

/** Which heads a marker draws: a line's (`edge`), a dimmed line's (7 × 5, `edge.dim`), a traced line's. */
type MarkerVariant = 'head' | 'dimhead' | 'tracehead';

/**
 * A kind's head marker for one end of a path, in one theme and variant: `dg-light-head-routes`,
 * `…-routes-start`, `dg-dark-dimhead-uses`, `dg-light-tracehead-routes`.
 */
function markerId(
  context: Context,
  kind: RelationKind,
  end: MarkerEnd,
  variant: MarkerVariant = 'head',
): string {
  return `${context.prefix}-${context.options.theme}-${variant}-${kind}${end === 'start' ? '-start' : ''}`;
}

function markerUrl(
  context: Context,
  kind: RelationKind,
  end: MarkerEnd,
  variant: MarkerVariant = 'head',
): string {
  return `url(#${markerId(context, kind, end, variant)})`;
}

function runSpans(runs: readonly TextRun[], className?: string): ReactNode {
  return runs.map((run, index) => (
    <tspan key={index} className={className} fontFamily={run.family === 'mono' ? MONO_STACK : undefined}>
      {run.text}
    </tspan>
  ));
}

function placedIcon(context: Context, icon: Icon, x: number, y: number): ReactNode {
  const plate =
    context.options.theme === 'dark' && icon.plateOnDark ? (
      <rect
        x={x - ICON_PLATE.inset}
        y={y - ICON_PLATE.inset}
        width={ICON + 2 * ICON_PLATE.inset}
        height={ICON + 2 * ICON_PLATE.inset}
        rx={ICON_PLATE.radius}
        fill={ICON_PLATE.fill}
        fillOpacity={ICON_PLATE.opacity}
      />
    ) : null;
  return (
    <>
      {plate}
      <use href={`#${iconId(context.prefix, icon)}`} x={x} y={y} />
    </>
  );
}

interface StructureAttributes<K extends 'zone' | 'node'> {
  readonly 'data-kind': K;
  readonly 'data-id': string;
  readonly 'data-n': number;
  readonly 'data-parent'?: number;
}

type GroupAttributes = SVGProps<SVGGElement> & StructureAttributes<'node'>;

/**
 * The markers of a zone's or a node's group that the draw.io export reads (export/drawio/translate.ts): what it is,
 * its id, its short index in the drawing (`data-n`, its place among the layout's rects), and the index of the zone it
 * lies in (none at the top level). Lines name their ends by these indices (`data-ends`), so a drawing repeats no asset
 * name: the markers add a few percent to an SVG, not a third. The canvas carries them too.
 */
function structureAttributes<K extends 'zone' | 'node'>(
  context: Context,
  kind: K,
  id: string,
  rect: LayoutRect,
): StructureAttributes<K> {
  const parent = rect.parent === null ? undefined : context.index.get(rect.parent);
  return {
    'data-kind': kind,
    'data-id': id,
    'data-n': context.index.get(id) ?? -1,
    ...(parent === undefined ? {} : { 'data-parent': parent }),
  };
}

/** What a timeline day's markers add to a node's accessible name: ", added since 2026-09-07", … */
function diffSuffix(context: Context, id: string): string {
  const diff = context.model.diff;
  if (diff === null) return '';
  const status = diff.status.get(id);
  const inside = diff.inside.get(id);
  if (status === undefined && inside === undefined) return '';
  return nameSuffix(status, inside, sincePhrase(diff.since, diff.forward, context.options.utcOffsetMinutes));
}

/** A solid node's group: its id, and in the interactive canvas a button with its accessible name. */
function nodeAttributes(context: Context, id: string, rect: LayoutRect, className: string): GroupAttributes {
  const node = context.model.nodes.get(id);
  if (!context.options.interactive) return { className, ...structureAttributes(context, 'node', id, rect) };
  return {
    className,
    ...structureAttributes(context, 'node', id, rect),
    role: 'button',
    tabIndex: -1,
    'aria-label': `${accessibleName(node, rect, id, context.model.input.zoneTypes?.[id])}${diffSuffix(context, id)}`,
    'aria-pressed': false,
  };
}

/** An open zone: its tinted body, then its header (icon, title, id after a middle dot, badges). */
function Zone({ context, id, rect }: { context: Context; id: string; rect: LayoutRect }): ReactElement {
  const { palette, options, model } = context;
  const node = model.nodes.get(id);
  const zone = node?.type === 'zone' ? node : undefined;
  const overlay = model.overlayZones.has(id);
  const tint = zoneTintOf(rect.kind === 'card' ? 'product-container' : rect.kind, rect.depth);
  const paint = palette.zone[tint];
  const stroke = zoneStroke(tint);
  const background = context.background.get(id) ?? palette.canvas;
  const size = zoneTitleSizeAt(rect.depth, SIZING);
  const badges = zone?.badges ?? [];
  const badgeWidths = badges.map(
    (badge) => measureText(badge, TEXT_WEIGHTS.badge, SIZING.badgeTextSize) + 2 * SIZING.badgePaddingX,
  );
  const badgeBlock =
    badges.length === 0
      ? 0
      : SIZING.headerBadgeGap +
        badgeWidths.reduce((a, b) => a + b, 0) +
        SIZING.badgeSpacing * (badges.length - 1);
  const folder = rect.kind === 'folder';
  const room =
    rect.width -
    SIZING.headerIcon -
    SIZING.headerIconGap -
    (folder ? 2 * rect.padding + badgeBlock : 2 * (rect.padding + badgeBlock));
  const label = zone?.label ?? id;
  const title = fitText(label, TEXT_WEIGHTS.zoneTitle, size, room);
  const titleWidth = measureText(title, TEXT_WEIGHTS.zoneTitle, size);
  // The id (or fact) after the middle dot, when it says something the title does not (skill §4).
  const subtitleRuns =
    zone?.subtitle === undefined || zone.subtitle === label || title !== label
      ? []
      : fitSubtitle(
          `${ZONE_TITLE_SEPARATOR}${zone.subtitle}`,
          TEXT_WEIGHTS.zoneTitleId,
          size,
          room - titleWidth,
        );
  const group =
    SIZING.headerIcon +
    SIZING.headerIconGap +
    titleWidth +
    runsWidth(subtitleRuns, TEXT_WEIGHTS.zoneTitleId, size);
  const left = folder ? rect.x + rect.padding : rect.x + (rect.width - group) / 2;
  const middle = rect.y + rect.headerHeight / 2;
  const icon = iconOfNode(model, id, rect);
  let badgeRight = rect.x + rect.width - rect.padding;
  const badgeElements = [...badges].reverse().map((badge, index) => {
    const width = badgeWidths[badges.length - 1 - index] ?? 0;
    badgeRight -= width;
    const element = (
      <g key={index}>
        <rect
          x={fmt(badgeRight)}
          y={fmt(middle - 9)}
          width={fmt(width)}
          height={18}
          rx={9}
          fill={palette.surface}
          stroke={palette.border}
        />
        <text
          className="dg-label"
          x={fmt(badgeRight + SIZING.badgePaddingX)}
          y={fmt(middle + 3.5)}
          fontSize={SIZING.badgeTextSize}
          fill={palette.muted}
        >
          {badge}
        </text>
      </g>
    );
    badgeRight -= SIZING.badgeSpacing;
    return element;
  });
  const name = accessibleName(node, rect, id, model.input.zoneTypes?.[id]);
  const attributes: SVGProps<SVGGElement> = options.interactive
    ? { role: 'graphics-object', 'aria-label': `${name}${diffSuffix(context, id)}` }
    : {};
  const iconY = rect.y + (rect.headerHeight - SIZING.headerIcon) / 2;
  return (
    <g className="dg-zone" {...structureAttributes(context, 'zone', id, rect)} {...attributes}>
      {overlay ? (
        <OverlayOutline palette={palette} box={rect} radius={ZONE_RADIUS} className="dg-body" />
      ) : (
        <rect
          className="dg-body"
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          rx={ZONE_RADIUS}
          fill={paint.fill}
          stroke={paint.stroke}
          strokeWidth={stroke.width}
          strokeDasharray={stroke.dash}
        />
      )}
      <g aria-hidden={options.interactive ? true : undefined}>
        {placedIcon(context, icon, left, iconY)}
        <text
          className="dg-label"
          xmlSpace="preserve"
          x={fmt(left + SIZING.headerIcon + SIZING.headerIconGap)}
          y={fmt(middle + size * 0.35)}
          fontSize={size}
          fontWeight={TEXT_WEIGHTS.zoneTitle}
          fill={palette.ink}
          stroke={background}
          strokeWidth={2 * HALO}
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {title}
          {subtitleRuns.length === 0 ? null : (
            <tspan
              className="dg-sub"
              fontWeight={TEXT_WEIGHTS.zoneTitleId}
              fill={readableOn(background, [palette.muted, palette.mutedOnTint])}
            >
              {runSpans(subtitleRuns)}
            </tspan>
          )}
        </text>
        {badgeElements}
      </g>
      {options.interactive && options.collapsible === true ? (
        <CollapseButton id={id} name={name} x={left} y={iconY} size={SIZING.headerIcon} palette={palette} />
      ) : null}
    </g>
  );
}

/** The chip's ⊞ glyph: 16 px, 8 px before the text, beside the count line. */
const CHIP_GLYPH = 16;
const CHIP_GLYPH_GAP = 8;
const CHIP_GLYPH_Y = 23;
/**
 * The chip's kind mark: its zone's header mark (a project's, a
 * folder's, a network's, a product's), 14 px, above the ⊞ glyph and beside the label, so a chip's kind never
 * rests on its tint alone (WCAG 1.4.1); the count line keeps its words.
 */
const CHIP_MARK = 14;
const CHIP_MARK_Y = 7;

function chipGlyphId(prefix: string): string {
  return `${prefix}-chip-glyph`;
}

/**
 * The ⊞ glyph of a chip (skill §4), defined once and placed with `<use>`: a square with a plus, drawn so it
 * does not depend on a font having the character.
 */
function ChipGlyphDefinition({ id, colour }: { id: string; colour: string }): ReactElement {
  return (
    <g id={id} fill="none" stroke={colour} strokeWidth={1.25}>
      <rect x={0.5} y={0.5} width={15} height={15} rx={2} />
      <path d="M8 4V12M4 8H12" />
    </g>
  );
}

/** A card, a chip or a card-sized empty zone: the solid nodes. */
function Solid({ context, id, rect }: { context: Context; id: string; rect: LayoutRect }): ReactElement {
  const { palette, model } = context;
  const node = model.nodes.get(id);
  const background = context.background.get(id) ?? palette.canvas;
  if (rect.role === 'chip') {
    // A chip's ⊞ glyph is 16 px, so its text starts earlier than a card's and keeps more room.
    const chipTextX = rect.x + SIZING.cardPadding + CHIP_GLYPH + CHIP_GLYPH_GAP;
    const chipRoom = rect.x + rect.width - SIZING.cardPadding - chipTextX;
    const zone = node?.type === 'zone' ? node : undefined;
    const tint = zoneTintOf(rect.kind === 'card' ? 'product-container' : rect.kind, rect.depth);
    const stroke = zoneStroke(tint);
    const counts = zone?.collapsed ?? {};
    const mark = iconOfNode(model, id, rect);
    const markX = rect.x + SIZING.cardPadding + (CHIP_GLYPH - CHIP_MARK) / 2;
    const full = chipCountLine(counts);
    const line =
      measureText(full, 400, SIZING.cardSubtitleSize) <= chipRoom
        ? full
        : fitText(chipCountLine(counts, true), 400, SIZING.cardSubtitleSize, chipRoom);
    return (
      <g {...nodeAttributes(context, id, rect, 'dg-node dg-chip')}>
        <rect
          className="dg-body"
          x={rect.x}
          y={rect.y}
          width={rect.width}
          height={rect.height}
          rx={CARD_RADIUS}
          fill={background}
          stroke={palette.zone[tint].stroke}
          strokeWidth={1}
          strokeDasharray={stroke.dash}
        />
        <g
          className="dg-chip-mark"
          transform={`translate(${fmt(markX)} ${fmt(rect.y + CHIP_MARK_Y)}) scale(${fmt(CHIP_MARK / ICON)})`}
        >
          {placedIcon(context, mark, 0, 0)}
        </g>
        <use
          href={`#${chipGlyphId(context.prefix)}`}
          x={rect.x + SIZING.cardPadding}
          y={rect.y + CHIP_GLYPH_Y}
        />
        <text
          className="dg-label"
          x={chipTextX}
          y={rect.y + 19}
          fontSize={SIZING.cardTitleSize}
          fontWeight={TEXT_WEIGHTS.cardTitle}
          fill={palette.chipText}
        >
          {fitText(zone?.label ?? id, TEXT_WEIGHTS.cardTitle, SIZING.cardTitleSize, chipRoom)}
        </text>
        <text
          className="dg-sub"
          x={chipTextX}
          y={rect.y + 34}
          fontSize={SIZING.cardSubtitleSize}
          fill={palette.chipText}
        >
          {line}
        </text>
      </g>
    );
  }
  const textX = rect.x + SIZING.cardPadding + ICON + SIZING.cardPadding;
  const room = rect.x + rect.width - SIZING.cardPadding - textX;
  const isCard = rect.role === 'card';
  const tint = isCard
    ? undefined
    : zoneTintOf(rect.kind === 'card' ? 'product-container' : rect.kind, rect.depth);
  const fill = isCard ? palette.card.fill : background;
  const strokeColour = tint === undefined ? palette.card.stroke : palette.zone[tint].stroke;
  const strokeStyle = tint === undefined ? { width: CARD_STROKE_WIDTH } : zoneStroke(tint);
  const label = node?.label ?? id;
  const subtitle = node?.subtitle;
  const title = fitText(label, TEXT_WEIGHTS.cardTitle, SIZING.cardTitleSize, room);
  const runs =
    subtitle === undefined
      ? []
      : fitSubtitle(subtitle, TEXT_WEIGHTS.cardSubtitle, SIZING.cardSubtitleSize, room);
  const icon = iconOfNode(model, id, rect);
  return (
    <g {...nodeAttributes(context, id, rect, isCard ? 'dg-node dg-card' : 'dg-node dg-empty')}>
      <rect
        className="dg-body"
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx={CARD_RADIUS}
        fill={fill}
        stroke={strokeColour}
        strokeWidth={strokeStyle.width}
        strokeDasharray={strokeStyle.dash}
      />
      {placedIcon(context, icon, rect.x + SIZING.cardPadding, rect.y + (rect.height - ICON) / 2)}
      <text
        className="dg-label"
        x={textX}
        y={rect.y + (runs.length === 0 ? 26 : 19)}
        fontSize={SIZING.cardTitleSize}
        fontWeight={TEXT_WEIGHTS.cardTitle}
        fill={palette.ink}
      >
        {title}
      </text>
      {runs.length === 0 ? null : (
        <text
          className="dg-sub"
          x={textX}
          y={rect.y + 34}
          fontSize={SIZING.cardSubtitleSize}
          fill={readableOn(fill, [palette.muted, palette.mutedOnTint])}
        >
          {runSpans(runs)}
        </text>
      )}
    </g>
  );
}

interface EdgeGeometry {
  readonly d: string;
  readonly start: boolean;
  readonly end: boolean;
}

/**
 * The drawn path of an edge and which of its ends carry a marker. A hub bundle's members are drawn from their
 * shared end (`bundle.end`), so their dash patterns coincide along the trunk; `sharedHeadDrawn` says whether
 * another member already drew the shared head. `head` replaces the kind's head (dim mode's 7 × 5 heads); the
 * line stops at a filled or hollow head's base, so the head's tip lands where the layout ended the edge.
 */
export function edgeGeometry(
  edge: DiagramEdge,
  sharedHeadDrawn: boolean,
  head: HeadStyle | undefined = edge.style.head,
): EdgeGeometry {
  const { path } = edge;
  const drawn: HeadStyle | undefined = path.heads === 'none' ? undefined : head;
  const trim = drawn === undefined || drawn.shape === 'open' ? 0 : drawn.length;
  const straight = drawn?.length ?? 0;
  const atSource = path.heads === 'both' && drawn !== undefined;
  const atTarget = drawn !== undefined;
  const reversed = path.bundle?.end === 'target';
  const sourceTrim = atSource ? trim : 0;
  const targetTrim = atTarget ? trim : 0;
  const points = reversed ? [...path.points].reverse() : path.points;
  const d = edgePathData(points, {
    radius: path.elbowRadius,
    trimStart: reversed ? targetTrim : sourceTrim,
    trimEnd: reversed ? sourceTrim : targetTrim,
    straightStart: (reversed ? atTarget : atSource) ? straight : 0,
    straightEnd: (reversed ? atSource : atTarget) ? straight : 0,
  });
  const shared = path.bundle?.end;
  const drawSource = atSource && !(shared === 'source' && sharedHeadDrawn);
  const drawTarget = atTarget && !(shared === 'target' && sharedHeadDrawn);
  return reversed ? { d, start: drawTarget, end: drawSource } : { d, start: drawSource, end: drawTarget };
}

function widthClass(style: EdgeStyle): string | undefined {
  return style.width === 2 ? 'dg-w2' : undefined;
}

/**
 * A traced line drawn on top (skill §6): the line again in `accent.select`, 3 px, its kind's dashes scaled to
 * the width and its heads in the same colour, over a `canvas` casing 4 px on each side. A static drawing with a
 * selection draws the traced lines' only; the interactive canvas draws none: its painter makes them from
 * {@link TracedPrototype} when it traces a line.
 */
function TracedLine({ context, edge }: { context: Context; edge: DiagramEdge }): ReactElement {
  // A traced copy draws its own heads, even a bundle's shared one.
  const own = edgeGeometry(edge, false);
  return (
    <g className="dg-traced" data-edge={edge.key}>
      <TracedPaths context={context} kind={edge.path.kind} d={own.d} start={own.start} end={own.end} />
    </g>
  );
}

/** A traced line's two paths: the `canvas` casing and the line in `accent.select` with its kind's heads. */
function TracedPaths({
  context,
  kind,
  d,
  start,
  end,
}: {
  context: Context;
  kind: RelationKind;
  d: string | undefined;
  start: boolean;
  end: boolean;
}): ReactElement {
  const { palette } = context;
  const style = edgeStyleOf(kind);
  return (
    <>
      <path
        className="dg-casing"
        d={d}
        fill="none"
        stroke={palette.canvas}
        strokeWidth={TRACE_WIDTH + 2 * CASING}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        className="dg-edge"
        d={d}
        fill="none"
        stroke={palette.accentSelect}
        strokeWidth={TRACE_WIDTH}
        strokeDasharray={traceDash(style)}
        strokeLinecap={style.head === undefined ? 'round' : undefined}
        markerStart={start ? markerUrl(context, kind, 'start', 'tracehead') : undefined}
        markerEnd={end ? markerUrl(context, kind, 'end', 'tracehead') : undefined}
      />
    </>
  );
}

/**
 * The interactive canvas's traced line of one relation kind without its path data, hidden: the painter
 * clones it for each line it traces (painter.ts, `tracedCopy`), sets the line's `d` and drops the heads the line
 * does not draw. Drawing a hidden copy of every line, as the canvas once did, doubled the drawing's elements in dim
 * mode (L at `all`: 8 914 of 31 052); one per kind is all the painter needs.
 */
function TracedPrototype({ context, kind }: { context: Context; kind: RelationKind }): ReactElement {
  const headed = edgeStyleOf(kind).head !== undefined;
  return (
    <g className={TRACED_PROTOTYPE_CLASS} data-kind={kind} display="none">
      <TracedPaths context={context} kind={kind} d={undefined} start={headed} end={headed} />
    </g>
  );
}

/** The lines (skill §5), each with its kind's stroke, dashes and heads; in dim mode in `edge.dim` with 7 × 5 heads. */
function Edges({ context }: { context: Context }): ReactElement {
  const { model, palette } = context;
  const drawnBundles = new Set<string>();
  const base: ReactNode[] = [];
  for (const edge of model.lines) {
    const bundleId = edge.path.bundle?.id;
    const { style } = edge;
    // Dim mode keeps every head, at 7 × 5 in edge.dim (skill §5): the line still ends at its target's border.
    const head = model.dim ? dimHead(style.head) : style.head;
    const variant: MarkerVariant = model.dim ? 'dimhead' : 'head';
    const geometry = edgeGeometry(edge, bundleId !== undefined && drawnBundles.has(bundleId), head);
    if (bundleId !== undefined) drawnBundles.add(bundleId);
    const startMarker = markerUrl(context, edge.path.kind, 'start', variant);
    const endMarker = markerUrl(context, edge.path.kind, 'end', variant);
    const caps = style.head === undefined ? 'round' : undefined;
    // What the draw.io export reads: the indices (`data-n`) of the nodes at the drawn path's start and end, in that
    // order (a hub bundle's member is drawn from its shared end). Not `data-id`, which names nodes only (the
    // painter's lookups).
    const reversed = edge.path.bundle?.end === 'target';
    const start = context.index.get(reversed ? edge.path.to : edge.path.from);
    const end = context.index.get(reversed ? edge.path.from : edge.path.to);
    const structure =
      start === undefined || end === undefined ? {} : { 'data-ends': `${String(start)} ${String(end)}` };
    // Fill, stroke colour (and in dim mode the width) are the group's; a path carries only what differs.
    base.push(
      model.dim ? (
        <path
          key={edge.key}
          {...structure}
          d={geometry.d}
          strokeDasharray={style.dash}
          strokeLinecap={caps}
          markerStart={geometry.start ? startMarker : undefined}
          markerEnd={geometry.end ? endMarker : undefined}
        />
      ) : (
        <path
          key={edge.key}
          {...structure}
          className={widthClass(style)}
          d={geometry.d}
          strokeWidth={style.width}
          strokeDasharray={style.dash}
          strokeLinecap={caps}
          markerStart={geometry.start ? startMarker : undefined}
          markerEnd={geometry.end ? endMarker : undefined}
        />
      ),
    );
  }
  return (
    <g
      className="dg-edges"
      aria-hidden="true"
      fill="none"
      stroke={model.dim ? palette.edgeDim : palette.edge}
      strokeWidth={model.dim ? DIM_EDGE_WIDTH : undefined}
    >
      {base}
    </g>
  );
}

/**
 * The traced lines on top of everything but the focus ring, the console action and the legend: over the rings,
 * so a ring's canvas gap never hides a traced line's head. A static drawing with a selection draws the traced
 * ones; the interactive canvas draws the layer with one hidden prototype per relation kind of its lines, from which
 * the painter makes the traced lines it shows.
 */
function TracedEdges({ context }: { context: Context }): ReactElement | null {
  const { model } = context;
  const top = context.options.interactive
    ? RELATION_KIND_IDS.filter((kind) => model.lines.some((edge) => edge.path.kind === kind)).map((kind) => (
        <TracedPrototype key={kind} context={context} kind={kind} />
      ))
    : model.lines.flatMap((edge) =>
        context.traced.has(edge.key) ? [<TracedLine key={edge.key} context={context} edge={edge} />] : [],
      );
  return top.length === 0 && !context.options.interactive ? null : (
    <g className={TRACED_LAYER_CLASS} aria-hidden="true">
      {top}
    </g>
  );
}

/**
 * A dashed `accent.path` outline at 50 % (skill §5) over its casing in `pathCasing` (`PATH_CASING` wider on each
 * side, the same dashes): the light amber reaches only 1.1–1.9 : 1 on the light fills, so it sits on the casing
 * as the selection ring sits on its canvas gap (theme.test.ts). The 50 % amber is laid over a canvas-coloured
 * core, so it reads as the same pale amber on every tint (over the bare casing it would mix to a muddy brown).
 * The `secures` overlays, a perimeter focus's overlay zones and the legend's sample draw it.
 */
function OverlayOutline({
  palette,
  box,
  radius,
  className,
}: {
  palette: DiagramPalette;
  box: Rect;
  radius: number;
  /** The line's class (an overlay zone's line is its `dg-body`). */
  className?: string;
}): ReactElement {
  return (
    <>
      <rect
        className="dg-overlay-casing"
        x={fmt(box.x)}
        y={fmt(box.y)}
        width={fmt(box.width)}
        height={fmt(box.height)}
        rx={fmt(radius)}
        fill="none"
        stroke={palette.pathCasing}
        strokeWidth={OVERLAY_WIDTH + 2 * PATH_CASING}
        strokeDasharray={OVERLAY_DASH}
      />
      <rect
        className="dg-overlay-backing"
        x={fmt(box.x)}
        y={fmt(box.y)}
        width={fmt(box.width)}
        height={fmt(box.height)}
        rx={fmt(radius)}
        fill="none"
        stroke={palette.canvas}
        strokeWidth={OVERLAY_WIDTH}
        strokeDasharray={OVERLAY_DASH}
      />
      <rect
        className={className}
        x={fmt(box.x)}
        y={fmt(box.y)}
        width={fmt(box.width)}
        height={fmt(box.height)}
        rx={fmt(radius)}
        fill="none"
        stroke={palette.accentPath}
        strokeOpacity={OVERLAY_OPACITY}
        strokeWidth={OVERLAY_WIDTH}
        strokeDasharray={OVERLAY_DASH}
      />
    </>
  );
}

/**
 * `secures` edges (skill §5): a dashed `accent.path` overlay at 50 % just inside each target's border, not a
 * line; painted under the lines (it never sits in the gutter the lines run in). Each overlay names its
 * policy: a `<title>` ("secures — web-armor", "secures — 2 policies") that a pointer resting on the dashes shows,
 * as the legend's row does for all of them. A click on the dashes selects the target (`data-secures`).
 */
function Overlays({ context }: { context: Context }): ReactElement | null {
  const { model, palette } = context;
  const sources = new Map<string, string[]>();
  for (const edge of model.overlayEdges) {
    const list = sources.get(edge.path.to);
    if (list === undefined) sources.set(edge.path.to, [edge.path.from]);
    else list.push(edge.path.from);
  }
  const targets = [...sources.keys()].sort();
  if (targets.length === 0) return null;
  return (
    <g className="dg-overlays" aria-hidden="true">
      {targets.map((id) => {
        const rect = model.input.layout.rects[id];
        if (rect === undefined) return null;
        const radius = Math.max((rect.role === 'zone' ? ZONE_RADIUS : CARD_RADIUS) - OVERLAY_INSET, 2);
        return (
          <g key={id} className="dg-overlay" data-secures={id}>
            <title>{securesLabel(model, sources.get(id) ?? [])}</title>
            <OverlayOutline
              palette={palette}
              box={ringBox(rect, -OVERLAY_INSET)}
              radius={radius}
              className="dg-overlay-line"
            />
          </g>
        );
      })}
    </g>
  );
}

/**
 * A kind's arrowhead for one end of a path (skill §5: filled, hollow or open, 9 × 7 or 7 × 5, in user units
 * whatever the stroke width). Two markers per kind, theme and variant, each with `orient="auto"`: the end
 * marker points along the path, the start marker is drawn pointing back. SVG 2's `auto-start-reverse` would
 * need only one, but the headless rasteriser and other SVG editors do not all support it, and exports must look
 * the same everywhere. A filled or hollow head is anchored at its base (the path stops there); an open head at
 * its tip. Variants: `head` in `edge`; `dimhead`, the kind's shape at 7 × 5 in `edge.dim` (dim mode);
 * `tracehead`, the kind's head in `accent.select` (traced lines).
 */
function Marker({
  context,
  kind,
  end,
  variant,
}: {
  context: Context;
  kind: RelationKind;
  end: MarkerEnd;
  variant: MarkerVariant;
}): ReactElement | null {
  const kindHead = edgeStyleOf(kind).head;
  const head = variant === 'dimhead' ? dimHead(kindHead) : kindHead;
  if (head === undefined) return null;
  const { palette } = context;
  const colour =
    variant === 'dimhead' ? palette.edgeDim : variant === 'tracehead' ? palette.accentSelect : palette.edge;
  const half = head.width / 2;
  const open = head.shape === 'open';
  const sign = end === 'end' ? 1 : -1;
  const tip = sign * head.length;
  return (
    <marker
      id={markerId(context, kind, end, variant)}
      viewBox={`${fmt(Math.min(0, tip))} ${fmt(-half)} ${fmt(head.length)} ${fmt(head.width)}`}
      markerWidth={head.length}
      markerHeight={head.width}
      markerUnits="userSpaceOnUse"
      refX={open ? tip : 0}
      refY={0}
      orient="auto"
      overflow="visible"
    >
      <path
        d={`M0 ${fmt(-half)}L${fmt(tip)} 0L0 ${fmt(half)}${open ? '' : 'Z'}`}
        fill={head.shape === 'filled' ? colour : head.shape === 'hollow' ? palette.canvas : 'none'}
        stroke={head.shape === 'filled' ? 'none' : colour}
        strokeWidth={open ? 1.2 : 1}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </marker>
  );
}

function TitleText({
  line,
  x,
  y,
  palette,
}: {
  line: TitleBlockLine;
  x: number;
  y: number;
  palette: DiagramPalette;
}): ReactElement {
  return (
    <text
      xmlSpace="preserve"
      x={fmt(x)}
      y={fmt(y + line.baseline)}
      fontSize={line.size}
      fontWeight={line.weight}
      fill={line.tone === 'ink' ? palette.ink : palette.muted}
    >
      {line.text}
    </text>
  );
}

function TitleBlockGroup({
  plan,
  palette,
}: {
  plan: NonNullable<DrawingPlan['title']>;
  palette: DiagramPalette;
}): ReactElement {
  const { x, y, block } = plan;
  return (
    <g className="dg-title-block" data-kind="title">
      <TitleText line={block.scope} x={x} y={y} palette={palette} />
      <TitleText line={block.meta} x={x} y={y} palette={palette} />
      <TitleText line={block.tagline} x={x} y={y} palette={palette} />
    </g>
  );
}

function LegendSwatch({
  context,
  row,
  x,
  y,
  dimSample,
}: {
  context: Context;
  row: LegendRow;
  x: number;
  y: number;
  /** The kind whose dimmed head the "dim" row shows. */
  dimSample: RelationKind | undefined;
}): ReactNode {
  const { palette } = context;
  const w = LEGEND.swatchWidth;
  const top = y + 3;
  switch (row.type) {
    case 'zone': {
      const stroke = zoneStroke(row.tint);
      const paint = palette.zone[row.tint];
      return (
        <rect
          x={x + 0.75}
          y={top}
          width={w - 1.5}
          height={14}
          rx={4}
          fill={paint.fill}
          stroke={paint.stroke}
          strokeWidth={stroke.width}
          strokeDasharray={stroke.dash}
        />
      );
    }
    case 'resource':
      return (
        <rect
          x={x + 0.75}
          y={top}
          width={w - 1.5}
          height={14}
          rx={4}
          fill={palette.card.fill}
          stroke={palette.card.stroke}
          strokeWidth={CARD_STROKE_WIDTH}
        />
      );
    case 'chip': {
      // A chip in its zone's tint, 1 px outline, with the ⊞ glyph (skill §4), like the chips it explains.
      const paint = palette.zone[row.tint];
      return (
        <>
          <rect
            x={x + 0.5}
            y={top}
            width={w - 1}
            height={14}
            rx={4}
            fill={paint.fill === 'none' ? palette.surface : paint.fill}
            stroke={paint.stroke}
            strokeWidth={1}
            strokeDasharray={zoneStroke(row.tint).dash}
          />
          <path
            d={`M${fmt(x + w / 2)} ${fmt(top + 3)}V${fmt(top + 11)}M${fmt(x + w / 2 - 4)} ${fmt(top + 7)}H${fmt(x + w / 2 + 4)}`}
            stroke={palette.chipText}
            strokeWidth={1.25}
          />
        </>
      );
    }
    case 'relation': {
      const style = edgeStyleOf(row.kind);
      const head = style.head;
      const both = RELATION_KINDS[row.kind].direction === 'both';
      const trim = head === undefined || head.shape === 'open' ? 0 : head.length;
      const x1 = x + 1 + (both ? trim : 0);
      const x2 = x + w - 1 - trim;
      return (
        <path
          d={`M${fmt(x1)} ${fmt(y + 10)}H${fmt(x2)}`}
          fill="none"
          stroke={palette.edge}
          strokeWidth={style.width}
          strokeDasharray={style.dash}
          strokeLinecap={head === undefined ? 'round' : undefined}
          markerStart={both && head !== undefined ? markerUrl(context, row.kind, 'start') : undefined}
          markerEnd={head === undefined ? undefined : markerUrl(context, row.kind, 'end')}
        />
      );
    }
    case 'overlay':
      return (
        <OverlayOutline palette={palette} box={{ x: x + 2, y: top, width: w - 4, height: 14 }} radius={4} />
      );
    case 'dim': {
      // A dimmed line with its 7 × 5 head, as dim mode draws them (when a kind with a head is drawn).
      const kind = dimSample;
      const head = kind === undefined ? undefined : dimHead(edgeStyleOf(kind).head);
      const trim = head === undefined || head.shape === 'open' ? 0 : head.length;
      return (
        <path
          d={`M${fmt(x + 1)} ${fmt(y + 10)}H${fmt(x + w - 1 - trim)}`}
          fill="none"
          stroke={palette.edgeDim}
          strokeWidth={DIM_EDGE_WIDTH}
          markerEnd={kind === undefined ? undefined : markerUrl(context, kind, 'end', 'dimhead')}
        />
      );
    }
    case 'selected': {
      // A small card with the selection ring around it, between canvas gaps.
      const card = { x: x + 8, y: top + 3, width: w - 16, height: 8 };
      const ring = ringBox(card, RING_GAP + SELECT_WIDTH / 2);
      return (
        <>
          <rect
            x={fmt(card.x)}
            y={fmt(card.y)}
            width={fmt(card.width)}
            height={fmt(card.height)}
            rx={2}
            fill={palette.card.fill}
            stroke={palette.card.stroke}
            strokeWidth={1}
          />
          <rect
            x={fmt(ring.x)}
            y={fmt(ring.y)}
            width={fmt(ring.width)}
            height={fmt(ring.height)}
            rx={5}
            fill="none"
            stroke={palette.canvas}
            strokeWidth={SELECT_WIDTH + 2 * RING_GAP}
          />
          <rect
            x={fmt(ring.x)}
            y={fmt(ring.y)}
            width={fmt(ring.width)}
            height={fmt(ring.height)}
            rx={5}
            fill="none"
            stroke={palette.accentSelect}
            strokeWidth={SELECT_WIDTH}
          />
        </>
      );
    }
    case 'trace': {
      // A traced line: accent.select 3 px with its head, over its canvas casing.
      const head = edgeStyleOf('routes').head;
      const d = `M${fmt(x + 2)} ${fmt(y + 10)}H${fmt(x + w - 1 - (head?.length ?? 0))}`;
      return (
        <>
          <path
            d={d}
            fill="none"
            stroke={palette.canvas}
            strokeWidth={TRACE_WIDTH + 2 * CASING}
            strokeLinecap="round"
          />
          <path
            d={d}
            fill="none"
            stroke={palette.accentSelect}
            strokeWidth={TRACE_WIDTH}
            markerEnd={markerUrl(context, 'routes', 'end', 'tracehead')}
          />
        </>
      );
    }
    case 'added': {
      // A small card with the added outline around it, between canvas gaps.
      const card = { x: x + 9, y: top + 4, width: w - 18, height: 6 };
      const ring = ringBox(card, RING_GAP + ADDED_WIDTH / 2);
      return (
        <>
          <rect
            x={fmt(card.x)}
            y={fmt(card.y)}
            width={fmt(card.width)}
            height={fmt(card.height)}
            rx={2}
            fill={palette.card.fill}
            stroke={palette.card.stroke}
            strokeWidth={1}
          />
          <rect
            x={fmt(ring.x)}
            y={fmt(ring.y)}
            width={fmt(ring.width)}
            height={fmt(ring.height)}
            rx={4}
            fill="none"
            stroke={palette.canvas}
            strokeWidth={ADDED_WIDTH + 2 * RING_GAP}
          />
          <rect
            x={fmt(ring.x)}
            y={fmt(ring.y)}
            width={fmt(ring.width)}
            height={fmt(ring.height)}
            rx={4}
            fill="none"
            stroke={palette.accentPeer}
            strokeWidth={ADDED_WIDTH}
          />
        </>
      );
    }
    case 'removed': {
      // A ghost: a card's body at 50 % with the dashed accent.removed outline on its canvas band.
      const box = { x: fmt(x + 2), y: fmt(top), width: fmt(w - 4), height: 14, rx: 4 };
      return (
        <>
          <rect {...box} fill={palette.card.fill} opacity={GHOST_OPACITY} />
          <rect
            {...box}
            fill="none"
            stroke={palette.canvas}
            strokeWidth={GHOST_STROKE_WIDTH + 2 * GHOST_BAND}
          />
          <rect
            {...box}
            fill="none"
            stroke={palette.accentRemoved}
            strokeWidth={GHOST_STROKE_WIDTH}
            strokeDasharray={GHOST_DASH}
          />
        </>
      );
    }
    case 'changed': {
      // A small card with the changed dot on its top-right corner, on its pathCasing disc.
      const card = { x: x + 4, y: top + 2, width: w - 10, height: 12 };
      const at = changedDotCentre({ ...card, role: 'card' });
      return (
        <>
          <rect
            x={fmt(card.x)}
            y={fmt(card.y)}
            width={fmt(card.width)}
            height={fmt(card.height)}
            rx={3}
            fill={palette.card.fill}
            stroke={palette.card.stroke}
            strokeWidth={1}
          />
          <circle
            cx={fmt(at.x)}
            cy={fmt(at.y)}
            r={CHANGED_DOT_RADIUS + CHANGED_DOT_CASING}
            fill={palette.pathCasing}
          />
          <circle cx={fmt(at.x)} cy={fmt(at.y)} r={CHANGED_DOT_RADIUS} fill={palette.accentPath} />
        </>
      );
    }
    case 'path':
      // A zone outline in accent.path 3 px on its casing band, as the path rings draw the zones to the root.
      return (
        <>
          <rect
            x={x + 3}
            y={top + 1}
            width={w - 6}
            height={12}
            rx={4}
            fill="none"
            stroke={palette.pathCasing}
            strokeWidth={PATH_WIDTH + 2 * PATH_CASING}
          />
          <rect
            x={x + 3}
            y={top + 1}
            width={w - 6}
            height={12}
            rx={4}
            fill="none"
            stroke={palette.accentPath}
            strokeWidth={PATH_WIDTH}
          />
        </>
      );
  }
}

function LegendRows({
  context,
  rows,
  dimSample,
}: {
  context: Context;
  rows: readonly PlacedLegendRow[];
  dimSample: RelationKind | undefined;
}): ReactNode {
  const { palette } = context;
  return rows.map(({ row, x, y }, index) => (
    <g key={index}>
      {row.type === 'overlay' && row.title !== undefined ? <title>{row.title}</title> : null}
      <LegendSwatch context={context} row={row} x={x} y={y} dimSample={dimSample} />
      <text
        x={fmt(x + LEGEND.swatchWidth + LEGEND.swatchGap)}
        y={fmt(y + 14)}
        fontSize={LEGEND.fontSize}
        fill={palette.ink}
      >
        {row.label}
      </text>
    </g>
  ));
}

/**
 * The legend panel (skill §7). Its trace column ("selected", "trace", "path to root") is shown while a node is
 * selected: a static drawing with a selection draws it shown; the interactive canvas draws it hidden, with the
 * panel's two sizes as `data-` attributes, and the painter shows it and widens the panel (attributes only).
 */
function LegendGroup({
  context,
  plan,
  dimSample,
}: {
  context: Context;
  plan: NonNullable<DrawingPlan['legend']>;
  dimSample: RelationKind | undefined;
}): ReactElement {
  const { palette, options } = context;
  const { layout } = plan;
  const { trace } = layout;
  const shown = trace !== null && !options.interactive;
  const width = shown ? trace.width : layout.width;
  const height = shown ? trace.height : layout.height;
  const sizes =
    trace === null || !options.interactive
      ? {}
      : {
          'data-width': fmt(layout.width - 1),
          'data-height': fmt(layout.height - 1),
          'data-trace-width': fmt(trace.width - 1),
          'data-trace-height': fmt(trace.height - 1),
        };
  return (
    <g className="dg-legend" data-kind="legend" transform={`translate(${fmt(plan.x)} ${fmt(plan.y)})`}>
      <rect
        className="dg-legend-panel"
        x={0.5}
        y={0.5}
        width={width - 1}
        height={height - 1}
        rx={8}
        fill={palette.surface}
        stroke={palette.border}
        {...sizes}
      />
      <text
        x={LEGEND.padding}
        y={LEGEND.padding + 11}
        fontSize={LEGEND.fontSize}
        fontWeight={700}
        fill={palette.ink}
      >
        {LEGEND_TITLE}
      </text>
      <LegendRows context={context} rows={layout.rows} dimSample={dimSample} />
      {trace === null ? null : (
        <g className="dg-legend-trace" display={shown ? undefined : 'none'}>
          <LegendRows context={context} rows={trace.rows} dimSample={dimSample} />
        </g>
      )}
    </g>
  );
}

/** A ring: a band (casing or canvas gap) under an accent stroke, both on the same outline. */
function Ring({
  className,
  band,
  bandWidth,
  line,
  lineWidth,
  lineClass,
  bandClass,
  placement,
  hidden,
}: {
  className: string;
  band: string;
  bandWidth: number;
  line: string;
  lineWidth: number;
  lineClass: string;
  bandClass: string;
  placement?: RingPlacement;
  hidden?: boolean;
}): ReactElement {
  const at =
    placement === undefined
      ? {}
      : {
          x: fmt(placement.x),
          y: fmt(placement.y),
          width: fmt(placement.width),
          height: fmt(placement.height),
          rx: fmt(placement.rx),
        };
  return (
    <g className={className} display={hidden === true ? 'none' : undefined}>
      <rect className={bandClass} fill="none" stroke={band} strokeWidth={bandWidth} {...at} />
      <rect className={lineClass} fill="none" stroke={line} strokeWidth={lineWidth} {...at} />
    </g>
  );
}

/** The reach rings of every node a trace reaches: one canvas-gap path and one `accent.select` path. */
function ReachRings({ palette, d }: { palette: DiagramPalette; d: string | null }): ReactElement {
  return (
    <g className="dg-reach-rings" display={d === null ? 'none' : undefined}>
      <path
        className="dg-ring-gap"
        d={d ?? undefined}
        fill="none"
        stroke={palette.canvas}
        strokeWidth={REACH_WIDTH + 2 * RING_GAP}
      />
      <path
        className="dg-ring"
        d={d ?? undefined}
        fill="none"
        stroke={palette.accentSelect}
        strokeWidth={REACH_WIDTH}
      />
    </g>
  );
}

function PathRing({
  palette,
  placement,
  hidden,
}: {
  palette: DiagramPalette;
  placement?: RingPlacement;
  hidden?: boolean;
}): ReactElement {
  return (
    <Ring
      className="dg-path-ring"
      bandClass="dg-path-casing"
      band={palette.pathCasing}
      bandWidth={PATH_WIDTH + 2 * PATH_CASING}
      lineClass="dg-path-line"
      line={palette.accentPath}
      lineWidth={PATH_WIDTH}
      {...(placement === undefined ? {} : { placement })}
      {...(hidden === undefined ? {} : { hidden })}
    />
  );
}

function SelectRing({
  palette,
  placement,
  hidden,
}: {
  palette: DiagramPalette;
  placement?: RingPlacement;
  hidden?: boolean;
}): ReactElement {
  return (
    <Ring
      className="dg-select-ring"
      bandClass="dg-ring-gap"
      band={palette.canvas}
      bandWidth={SELECT_WIDTH + 2 * RING_GAP}
      lineClass="dg-ring"
      line={palette.accentSelect}
      lineWidth={SELECT_WIDTH}
      {...(placement === undefined ? {} : { placement })}
      {...(hidden === undefined ? {} : { hidden })}
    />
  );
}

/**
 * The interactive marks, hidden until the highlight painter places them: the path to the root (one ring per
 * level of the deepest chain, each an `accent.path` line on its `pathCasing` band, drawn on a zone's border),
 * the reach rings and the selection (pulsing), each between canvas gaps. Drawn over the nodes and the lines, so
 * a highlighted outline is never hidden by a sibling, and under the traced lines, whose heads stay whole.
 */
function Marks({ palette, pathRings }: { palette: DiagramPalette; pathRings: number }): ReactElement {
  return (
    <g className="dg-marks" aria-hidden="true">
      <g className="dg-path-rings">
        {Array.from({ length: pathRings }, (_, index) => (
          <PathRing key={index} palette={palette} hidden />
        ))}
      </g>
      <ReachRings palette={palette} d={null} />
      <SelectRing palette={palette} hidden />
    </g>
  );
}

/** Keyboard focus (skill §9): the focus ring between canvas gaps, on top of everything it may surround. */
function FocusMark({ palette }: { palette: DiagramPalette }): ReactElement {
  return (
    <g className="dg-marks dg-focus-mark" aria-hidden="true">
      <Ring
        className="dg-focus-ring"
        bandClass="dg-ring-gap"
        band={palette.canvas}
        bandWidth={FOCUS_WIDTH + 2 * RING_GAP}
        lineClass="dg-ring"
        line={palette.focus}
        lineWidth={FOCUS_WIDTH}
        hidden
      />
    </g>
  );
}

/** A static drawing's selection: the path rings of the zones to the root, the reach rings, the selection ring. */
function TraceMarks({ context, trace }: { context: Context; trace: Trace }): ReactElement | null {
  const { palette, model } = context;
  const rects = model.input.layout.rects;
  const node = rects[trace.node];
  if (node === undefined) return null;
  const reached = trace.reached.flatMap((id) => {
    const rect = rects[id];
    return rect === undefined ? [] : [rect];
  });
  return (
    <g className="dg-marks" aria-hidden="true">
      <g className="dg-path-rings">
        {trace.ancestors.map((id) => {
          const rect = rects[id];
          return rect === undefined ? null : (
            <PathRing key={id} palette={palette} placement={ringPlacement(rect, 0)} />
          );
        })}
      </g>
      {reached.length === 0 ? null : <ReachRings palette={palette} d={reachPathData(reached)} />}
      <SelectRing palette={palette} placement={ringPlacement(node, SELECT_DISTANCE)} />
    </g>
  );
}

/**
 * The selected node's "Open in Cloud Console ↗" action (style skill §6), drawn once, hidden, for the painter to
 * place in the selected node's top-right corner, inside the node: an SVG link (`target="_blank"`,
 * `rel="noopener noreferrer"`) that opens the page in a new tab only when activated. While shown it is a tab stop
 * after the node (the painter sets its `tabindex`; the drawing's other tab stop is its roving node); keyboard users
 * also reach the same action with Enter on the selected card, or Shift+F10, in its menu. The painter names it.
 *
 * Two variants, the resource's page and, for a type without a console template, its project's console home,
 * each with its tooltip (`<title>`), an icon-only pill (a 16 px circle around the ↗ glyph) and a labelled pill
 * the stylesheet shows instead on hover and keyboard focus where the painter says it fits (`data-expand`). Both
 * pills are drawn leftwards from the anchor (the group's origin), so placing the action is one `transform`.
 */
function ConsoleActionLink({ palette }: { palette: DiagramPalette }): ReactElement {
  const { height, compactWidth, radius, glyphStroke, paddingX, fontSize, fontWeight } = CONSOLE_ACTION;
  const glyph = (
    <path
      className="dg-console-glyph"
      d={consoleGlyphPath()}
      fill="none"
      stroke={palette.accentSelect}
      strokeWidth={glyphStroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
  const pill = (width: number): ReactElement => (
    <rect
      className="dg-console-pill"
      x={-width}
      y={0}
      width={width}
      height={height}
      rx={radius}
      fill={palette.canvas}
      stroke={palette.accentSelect}
      strokeWidth={1}
    />
  );
  const variant = (kind: 'resource' | 'project', label: string): ReactElement => {
    const width = consoleActionWidth(label);
    return (
      <g
        className={`dg-console-variant dg-console-${kind}`}
        display={kind === 'project' ? 'none' : undefined}
        data-width={width}
      >
        <title>{`${label} ↗ (opens a new tab)`}</title>
        <g className="dg-console-compact">
          {pill(compactWidth)}
          {glyph}
        </g>
        <g className="dg-console-full" display="none">
          {pill(width)}
          <text
            className="dg-console-text"
            x={-width + paddingX}
            y={fmt(height / 2 + fontSize * 0.35)}
            fontSize={fontSize}
            fontWeight={fontWeight}
            fill={palette.accentSelect}
          >
            {label}
          </text>
          {glyph}
        </g>
      </g>
    );
  };
  return (
    <g className="dg-actions" display="none">
      <a className="dg-console-action" target="_blank" rel="noopener noreferrer" tabIndex={-1}>
        {variant('resource', CONSOLE_LABELS.resource)}
        {variant('project', CONSOLE_LABELS.project)}
      </a>
    </g>
  );
}

/**
 * What each ghost lies on (its parent's body: a ghost's when the parent is one too, else the drawn background) and
 * the colour its own body shows there (its fill at `GHOST_OPACITY` over that), in paint order.
 */
interface GhostGround {
  readonly behind: string;
  readonly body: string;
}

function ghostGrounds(
  model: DiagramModel,
  palette: DiagramPalette,
  background: ReadonlyMap<string, string>,
  overlays: ReadonlySet<string>,
): Map<string, GhostGround> {
  const grounds = new Map<string, GhostGround>();
  for (const [id, rect] of model.ghosts) {
    const behind =
      rect.parent === null
        ? palette.canvas
        : (grounds.get(rect.parent)?.body ?? background.get(rect.parent) ?? palette.canvas);
    const fill = ghostFill(palette, rect, behind, overlays.has(id));
    grounds.set(id, { behind, body: blendOver(fill, GHOST_OPACITY, behind) });
  }
  return grounds;
}

/**
 * A ghost's own fill before its opacity: a card's, or its zone's tint (a region's, and an overlay's, which have
 * none: what it lies on).
 */
function ghostFill(palette: DiagramPalette, rect: LayoutRect, behind: string, overlay: boolean): string {
  if (rect.kind === 'card') return palette.card.fill;
  const fill = overlay ? 'none' : palette.zone[zoneTintOf(rect.kind, rect.depth)].fill;
  return fill === 'none' ? behind : fill;
}

/** The nearest open zone of the drawn day around a ghost (a ghost inside a ghost lies in its ghost's zone). */
function ghostContainer(model: DiagramModel, rect: LayoutRect): string | null {
  const rects = model.input.layout.rects;
  let up = rect.parent;
  for (let step = 0; up !== null && step <= model.ghosts.length; step += 1) {
    if (model.diff?.ghosts.has(up) !== true) return up;
    up = rects[up]?.parent ?? null;
  }
  return null;
}

/**
 * A ghost (skill §6): what the view drew on the day on screen before and no longer draws, where the layout
 * placed it (its old place among its siblings), for one day. Its body (fill and icon) at 50 %, its label and a
 * "removed" line in the readable grey of that body (an open zone's title placed as the zone's, with its halo), and
 * a dashed `accent.removed` outline at full strength on a canvas band. The ghost of the earlier day's overlay zone
 * (a perimeter drawn around its projects) is drawn as an overlay: untinted, with its header mark, and the overlay's
 * dashed outline (`OverlayOutline`) `OVERLAY_INSET` inside the red one, where a `secures` overlay lies in its target.
 * Not a node: no `data-id`, no tab stop, never selected; the pointer on it is on the zone it lies in (`data-in`,
 * painter.ts `nodeIdOf`); its tooltip and name say what it was.
 */
function Ghost({
  context,
  id,
  rect,
  reason,
  overlay,
  since,
  ground,
}: {
  context: Context;
  id: string;
  rect: LayoutRect;
  reason: GhostReason;
  /** The earlier day drew it as the view's overlay zone. */
  overlay: boolean;
  since: string;
  ground: GhostGround;
}): ReactElement {
  const { palette, model, options } = context;
  const node = model.nodes.get(id);
  const fill = ghostFill(palette, rect, ground.behind, overlay);
  const ink = readableOn(ground.body, [palette.muted, palette.mutedOnTint]);
  const zone = rect.role === 'zone';
  const radius = zone ? ZONE_RADIUS : CARD_RADIUS;
  const text = ghostText(reason, accessibleName(node, rect, id, model.input.zoneTypes?.[id]), since);
  const icon = iconOfNode(model, id, rect);
  const label = node?.label ?? id;
  const outline = {
    x: fmt(rect.x),
    y: fmt(rect.y),
    width: fmt(rect.width),
    height: fmt(rect.height),
    rx: radius,
  };
  // An overlay's dashes, inside the ghost's outline (where a `secures` overlay lies in its target).
  const overlayLine = overlay ? (
    <OverlayOutline
      palette={palette}
      box={ringBox(rect, -OVERLAY_INSET)}
      radius={Math.max(radius - OVERLAY_INSET, 2)}
      className="dg-ghost-overlay"
    />
  ) : null;
  let content: ReactNode;
  if (zone) {
    // An open zone's ghost: its header mark and its title with the ghost's line after a middle dot, top-left for a
    // folder and centred otherwise (skill §4), with the halo zone titles have (skill §3).
    const size = zoneTitleSizeAt(rect.depth, SIZING);
    const folder = rect.kind === 'folder';
    const room = rect.width - 2 * rect.padding - SIZING.headerIcon - SIZING.headerIconGap;
    const title = fitText(
      `${label}${ZONE_TITLE_SEPARATOR}${GHOST_LINE[reason]}`,
      TEXT_WEIGHTS.zoneTitle,
      size,
      room,
    );
    const group = SIZING.headerIcon + SIZING.headerIconGap + measureText(title, TEXT_WEIGHTS.zoneTitle, size);
    const left = folder ? rect.x + rect.padding : rect.x + (rect.width - group) / 2;
    const iconY = rect.y + (rect.headerHeight - SIZING.headerIcon) / 2;
    content = (
      <>
        <g opacity={GHOST_OPACITY}>
          <rect {...outline} fill={fill} />
          {placedIcon(context, icon, left, iconY)}
        </g>
        {overlayLine}
        <text
          className="dg-label"
          xmlSpace="preserve"
          x={fmt(left + SIZING.headerIcon + SIZING.headerIconGap)}
          y={fmt(rect.y + rect.headerHeight / 2 + size * 0.35)}
          fontSize={size}
          fontWeight={TEXT_WEIGHTS.zoneTitle}
          fill={ink}
          stroke={ground.body}
          strokeWidth={2 * HALO}
          strokeLinejoin="round"
          paintOrder="stroke"
        >
          {title}
        </text>
      </>
    );
  } else {
    // A card's, a chip's or a card-sized zone's ghost: its icon, its label and the ghost's line, as a card.
    const textX = rect.x + SIZING.cardPadding + ICON + SIZING.cardPadding;
    const room = rect.x + rect.width - SIZING.cardPadding - textX;
    content = (
      <>
        <g opacity={GHOST_OPACITY}>
          <rect {...outline} fill={fill} />
          {placedIcon(context, icon, rect.x + SIZING.cardPadding, rect.y + (rect.height - ICON) / 2)}
        </g>
        {overlayLine}
        <text
          className="dg-label"
          x={fmt(textX)}
          y={fmt(rect.y + 19)}
          fontSize={SIZING.cardTitleSize}
          fontWeight={TEXT_WEIGHTS.cardTitle}
          fill={ink}
        >
          {fitText(label, TEXT_WEIGHTS.cardTitle, SIZING.cardTitleSize, room)}
        </text>
        <text
          className="dg-sub"
          x={fmt(textX)}
          y={fmt(rect.y + 34)}
          fontSize={SIZING.cardSubtitleSize}
          fill={ink}
        >
          {fitText(GHOST_LINE[reason], TEXT_WEIGHTS.cardSubtitle, SIZING.cardSubtitleSize, room)}
        </text>
      </>
    );
  }
  const container = ghostContainer(model, rect);
  const attributes: SVGProps<SVGGElement> = options.interactive
    ? { role: 'graphics-symbol', 'aria-label': text }
    : {};
  return (
    <g
      className="dg-ghost"
      data-ghost={id}
      data-reason={reason}
      {...(container === null ? {} : { 'data-in': container })}
      {...attributes}
    >
      <title>{text}</title>
      {content}
      <rect
        className="dg-ghost-band"
        {...outline}
        fill="none"
        stroke={palette.canvas}
        strokeWidth={GHOST_STROKE_WIDTH + 2 * GHOST_BAND}
      />
      <rect
        className="dg-ghost-line"
        {...outline}
        fill="none"
        stroke={palette.accentRemoved}
        strokeWidth={GHOST_STROKE_WIDTH}
        strokeDasharray={GHOST_DASH}
      />
    </g>
  );
}

/** The ghosts of a timeline day, after the nodes, in paint order (a ghost zone before what it holds). */
function Ghosts({ context, diff }: { context: Context; diff: DiffMarks }): ReactElement | null {
  const { model, palette, options } = context;
  if (model.ghosts.length === 0) return null;
  const since = sincePhrase(diff.since, diff.forward, options.utcOffsetMinutes);
  const overlays = new Set(diff.overlays);
  const grounds = ghostGrounds(model, palette, context.background, overlays);
  return (
    <g className="dg-ghosts">
      {model.ghosts.map(([id, rect]) => (
        <Ghost
          key={id}
          context={context}
          id={id}
          rect={rect}
          reason={diff.ghosts.get(id) ?? 'removed'}
          overlay={overlays.has(id)}
          since={since}
          ground={grounds.get(id) ?? { behind: palette.canvas, body: palette.canvas }}
        />
      ))}
    </g>
  );
}

/**
 * A timeline day's added outlines and changed dots (skill §6; diff/marks.ts), under the overlays and the
 * lines. Every outline's canvas gaps are drawn before any outline's line, so two added neighbours never cover each
 * other's line; each dot lies on its `pathCasing` disc.
 */
function DiffMarkers({ context, diff }: { context: Context; diff: DiffMarks }): ReactElement | null {
  const { palette, model } = context;
  const rects = model.input.layout.rects;
  if (diff.added.length === 0 && diff.changed.length === 0) return null;
  const outlined = diff.added.flatMap((id) => {
    const rect = rects[id];
    return rect === undefined ? [] : [[id, addedPathData([rect])] as const];
  });
  return (
    <g className="dg-diff" aria-hidden="true">
      {outlined.length === 0 ? null : (
        <g className="dg-added" fill="none">
          <g className="dg-added-gaps" stroke={palette.canvas} strokeWidth={ADDED_WIDTH + 2 * RING_GAP}>
            {outlined.map(([id, d]) => (
              <path key={id} d={d} />
            ))}
          </g>
          <g className="dg-added-lines" stroke={palette.accentPeer} strokeWidth={ADDED_WIDTH}>
            {outlined.map(([id, d]) => (
              <path key={id} data-added={id} d={d} />
            ))}
          </g>
        </g>
      )}
      {diff.changed.map((id) => {
        const rect = rects[id];
        if (rect === undefined) return null;
        const at = changedDotCentre(rect);
        return (
          <g key={id} className="dg-changed" data-changed={id}>
            <circle
              cx={fmt(at.x)}
              cy={fmt(at.y)}
              r={CHANGED_DOT_RADIUS + CHANGED_DOT_CASING}
              fill={palette.pathCasing}
            />
            <circle cx={fmt(at.x)} cy={fmt(at.y)} r={CHANGED_DOT_RADIUS} fill={palette.accentPath} />
          </g>
        );
      })}
    </g>
  );
}

/** Everything the diagram draws, as children of one `<g>`; wrap it in an `<svg>` (DiagramSvg, the canvas). */
export function DiagramDrawing({
  model,
  options,
  plan,
}: {
  model: DiagramModel;
  options: DrawingOptions;
  plan: DrawingPlan;
}): ReactElement {
  const palette = PALETTES[options.theme];
  const prefix = options.idPrefix ?? 'dg';
  const context: Context = {
    model,
    options,
    palette,
    prefix,
    background: backgrounds(model, palette),
    trace: plan.trace,
    traced: new Set(plan.trace?.edges ?? []),
    index: new Map(model.rects.map(([id], at) => [id, at])),
  };
  const legendMarkers = plan.legend?.rows.flatMap((row) => (row.type === 'relation' ? [row.kind] : [])) ?? [];
  const markers = RELATION_KIND_IDS.filter(
    (kind) => plan.markers.includes(kind) || legendMarkers.includes(kind),
  );
  const zones = model.rects.filter(([, rect]) => rect.role === 'zone');
  const solids = model.rects.filter(([, rect]) => rect.role !== 'zone');
  const { frame } = plan;
  const variants: ReadonlyArray<readonly [MarkerVariant, readonly RelationKind[]]> = [
    ['head', markers],
    ['dimhead', plan.dimMarkers],
    ['tracehead', plan.traceMarkers],
  ];
  return (
    <g className="dg-drawing" fontFamily={SANS_STACK}>
      <defs>
        {variants.map(([variant, kinds]) =>
          kinds.map((kind) => (
            <Fragment key={`${variant}-${kind}`}>
              <Marker context={context} kind={kind} end="end" variant={variant} />
              <Marker context={context} kind={kind} end="start" variant={variant} />
            </Fragment>
          )),
        )}
        {model.input.layout.chips.length === 0 ? null : (
          <ChipGlyphDefinition id={chipGlyphId(prefix)} colour={palette.chipText} />
        )}
        {plan.icons.map((icon) => (
          <g
            key={icon.key}
            id={iconId(prefix, icon)}
            dangerouslySetInnerHTML={{ __html: placeIconMarkup(icon, ICON) }}
          />
        ))}
      </defs>
      <rect
        className="dg-background"
        x={frame.x}
        y={frame.y}
        width={frame.width}
        height={frame.height}
        fill={palette.canvas}
      />
      {plan.title === null ? null : <TitleBlockGroup plan={plan.title} palette={palette} />}
      <g className="dg-zones">
        {zones.map(([id, rect]) => (
          <Zone key={id} context={context} id={id} rect={rect} />
        ))}
      </g>
      <g className="dg-nodes">
        {solids.map(([id, rect]) => (
          <Solid key={id} context={context} id={id} rect={rect} />
        ))}
      </g>
      {model.diff === null ? null : <Ghosts context={context} diff={model.diff} />}
      {model.diff === null ? null : <DiffMarkers context={context} diff={model.diff} />}
      <Overlays context={context} />
      <Edges context={context} />
      {options.interactive ? <Marks palette={palette} pathRings={model.deepestChain} /> : null}
      {!options.interactive && plan.trace !== null ? (
        <TraceMarks context={context} trace={plan.trace} />
      ) : null}
      <TracedEdges context={context} />
      {options.interactive ? <FocusMark palette={palette} /> : null}
      {options.interactive ? <ConsoleActionLink palette={palette} /> : null}
      {plan.legend === null ? null : (
        <LegendGroup context={context} plan={plan.legend} dimSample={plan.dimMarkers[0]} />
      )}
    </g>
  );
}
