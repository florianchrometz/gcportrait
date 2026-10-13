// SPDX-License-Identifier: MIT
/**
 * A plain SVG of a Layout for looking at the packing and the routing: tinted zone rects with their header
 * text, chips, empty zones and cards with their labels, the routed edges in ink with their arrowheads and
 * dashes (skill gcp-diagram-style §5: strokes, dashes and heads per relation kind; elbows rounded with the
 * edge's `elbowRadius`, clamped beside a head; a hub bundle drawn from its shared end with one head),
 * optionally each container's children box with its packing aspect. A development aid
 * only, not the SVG renderer: no icons (an outlined square marks the icon slot), no legend, no dim mode.
 * Colours are the style skill's tokens (gcp-diagram-style §2) in either theme. Like every drawing, it carries no
 * affiliation line (agents.md, Non-affiliation, brand and legal), and neither does the command's banner.
 */
import {
  chipCountLine,
  ASPECT_TOLERANCE,
  TEXT_WEIGHTS,
  ZONE_TITLE_SEPARATOR,
  measureText,
  packingAspects,
  subtitleRuns,
  zoneTitleSizeAt,
  DEFAULT_SIZING,
  type FontFamily,
  type FontWeight,
  type EdgePath,
  type Layout,
  type LayoutRect,
  type Point,
  type TextRun,
} from '../../src/index.js';
import type { RelationKind, Scene, SceneNode } from '@gcportrait/model';

export type Theme = 'light' | 'dark';

interface Palette {
  readonly canvas: string;
  readonly ink: string;
  readonly muted: string;
  readonly border: string;
  readonly surface: string;
  readonly folder: readonly [string, string];
  readonly project: readonly [string, string];
  readonly vpc: readonly [string, string];
  readonly subnet: readonly [string, string];
  readonly nested: readonly [string, string];
  readonly other: readonly [string, string];
  readonly card: readonly [string, string];
  readonly accent: string;
}

const PALETTES: Readonly<Record<Theme, Palette>> = {
  light: {
    canvas: '#FFFFFF',
    ink: '#202124',
    muted: '#5F6368',
    border: '#DADCE0',
    surface: '#F8F9FA',
    folder: ['#F1F3F4', '#9AA0A6'],
    project: ['#A8C7FA', '#202124'],
    vpc: ['#CEEAD6', '#A8DAB5'],
    subnet: ['#FFEEBD', '#FDE293'],
    nested: ['#D2E3FC', '#9AA0A6'],
    other: ['#F8F9FA', '#9AA0A6'],
    card: ['#FFFFFF', '#202124'],
    accent: '#F9AB00',
  },
  dark: {
    canvas: '#1F1F1F',
    ink: '#E8EAED',
    muted: '#9AA0A6',
    border: '#5F6368',
    surface: '#303134',
    folder: ['#2A2B2E', '#5F6368'],
    project: ['#1C3A5E', '#8AB4F8'],
    vpc: ['#1E3A2A', '#81C995'],
    subnet: ['#3D3419', '#FDD663'],
    nested: ['#2D3F55', '#5F6368'],
    other: ['#303134', '#5F6368'],
    card: ['#2B2C2F', '#BDC1C6'],
    accent: '#FDD663',
  },
};

function tintOf(rect: LayoutRect, palette: Palette): readonly [string, string] {
  switch (rect.kind) {
    case 'folder':
      return palette.folder;
    case 'project':
      return palette.project;
    case 'vpc':
      return palette.vpc;
    case 'subnet':
      return palette.subnet;
    case 'region':
      return ['none', palette.border];
    case 'card':
      return palette.card;
    case 'group':
      return palette.other;
    case 'product-container':
      return rect.depth >= 3 ? palette.nested : palette.other;
  }
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}

/** `text`, cut with an ellipsis so it fits `width` px at the given weight and size (debug only). */
function fit(text: string, weight: FontWeight, size: number, width: number): string {
  if (measureText(text, weight, size) <= width) return text;
  const chars = Array.from(text);
  while (chars.length > 0 && measureText(`${chars.join('')}…`, weight, size) > width) chars.pop();
  return `${chars.join('')}…`;
}

const FAMILIES: Readonly<Record<FontFamily, string>> = { sans: 'Roboto', mono: 'Roboto Mono' };

function textElement(
  x: number,
  y: number,
  text: string,
  options: {
    size: number;
    weight: FontWeight;
    fill: string;
    anchor?: 'start' | 'middle' | 'end';
    family?: FontFamily;
  },
): string {
  const anchor =
    options.anchor === undefined || options.anchor === 'start' ? '' : ` text-anchor="${options.anchor}"`;
  return `<text xml:space="preserve" x="${String(x)}" y="${String(y)}" font-family="${FAMILIES[options.family ?? 'sans']}" font-size="${String(options.size)}" font-weight="${String(options.weight)}" fill="${options.fill}"${anchor}>${escape(text)}</text>`;
}

/** Text runs in their faces, cut with an ellipsis to fit `width` px (debug only), one positioned element each. */
function runElements(
  x: number,
  y: number,
  runs: readonly TextRun[],
  options: { size: number; weight: FontWeight; fill: string; width: number },
): string[] {
  const elements: string[] = [];
  let at = x;
  for (const run of runs) {
    const room = x + options.width - at;
    const measure = (text: string): number =>
      measureText(text, options.weight, options.size, { family: run.family });
    let text = run.text;
    if (measure(text) > room) {
      const chars = Array.from(text);
      while (chars.length > 0 && measure(`${chars.join('')}…`) > room) chars.pop();
      text = `${chars.join('')}…`;
    }
    elements.push(textElement(at, y, text, { ...options, family: run.family }));
    at += measure(text);
    if (text !== run.text) break;
  }
  return elements;
}

/** A chip's count line as the layout sized it (`chipWidth`: the full form when it fits, else the short one). */
function chipLine(node: SceneNode | undefined, width: number): string {
  if (node?.type !== 'zone' || node.collapsed === undefined) return '';
  const room =
    width - 2 * DEFAULT_SIZING.cardPadding - DEFAULT_SIZING.chipGlyph - DEFAULT_SIZING.chipGlyphGap;
  const full = chipCountLine(node.collapsed);
  return measureText(full, 400, DEFAULT_SIZING.cardSubtitleSize) <= room
    ? full
    : chipCountLine(node.collapsed, true);
}

/**
 * Zone stroke width (skill gcp-diagram-style §4): 1 px for folders, regions, product containers and groups,
 * 1.5 px for projects, VPC networks and subnetworks.
 */
function zoneStrokeWidth(rect: LayoutRect): string {
  return rect.kind === 'project' || rect.kind === 'vpc' || rect.kind === 'subnet' ? '1.5' : '1';
}

/** Stroke, dash and arrowhead per relation kind (skill gcp-diagram-style §5). */
interface EdgeStyle {
  readonly width: number;
  readonly dash?: string;
  /** Arrowhead length × width, and whether it is filled; absent: no head (round caps). */
  readonly head?: {
    readonly length: number;
    readonly width: number;
    readonly fill: 'solid' | 'open' | 'hollow';
  };
}

const EDGE_STYLES: Readonly<Record<RelationKind, EdgeStyle>> = {
  contains: { width: 1.5, head: { length: 7, width: 5, fill: 'solid' } },
  routes: { width: 2, head: { length: 9, width: 7, fill: 'solid' } },
  uses: { width: 2, head: { length: 9, width: 7, fill: 'solid' } },
  triggers: { width: 2, head: { length: 9, width: 7, fill: 'solid' } },
  attaches: { width: 1.5, head: { length: 7, width: 5, fill: 'solid' } },
  peers: { width: 2, dash: '6 5', head: { length: 9, width: 7, fill: 'solid' } },
  connects: { width: 2 },
  memberOf: { width: 1.2, dash: '1 3', head: { length: 7, width: 5, fill: 'open' } },
  runsAs: { width: 1.2, dash: '1 3', head: { length: 7, width: 5, fill: 'open' } },
  encryptedBy: { width: 1.2, dash: '1 3', head: { length: 7, width: 5, fill: 'open' } },
  replicates: { width: 2, head: { length: 9, width: 7, fill: 'hollow' } },
  shares: { width: 1.5, dash: '8 4', head: { length: 7, width: 5, fill: 'solid' } },
  secures: { width: 1.5, dash: '8 4', head: { length: 7, width: 5, fill: 'solid' } },
};

const fmt = (value: number): string => String(Math.round(value * 100) / 100);

/**
 * An SVG path through `points` with each elbow rounded (quadratic, radius at most half each segment). `startRoom`
 * and `endRoom` are the lengths a head takes at either end: the elbow next to a head keeps its rounding off the
 * head's straight stretch (the radius is clamped to what the end segment leaves beside the head).
 */
function roundedPath(points: readonly Point[], radius: number, startRoom = 0, endRoom = 0): string {
  const first = points[0];
  if (first === undefined) return '';
  const parts = [`M${fmt(first.x)} ${fmt(first.y)}`];
  const length = (a: Point, b: Point): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const lastElbow = points.length - 2;
  for (let i = 1; i < points.length; i += 1) {
    const point = points[i] as Point;
    const previous = points[i - 1] as Point;
    const next = points[i + 1];
    if (next === undefined || radius <= 0) {
      parts.push(`L${fmt(point.x)} ${fmt(point.y)}`);
      continue;
    }
    const inLength = length(previous, point);
    const outLength = length(point, next);
    let r = Math.min(radius, inLength / 2, outLength / 2);
    if (i === 1 && startRoom > 0) r = Math.max(0, Math.min(r, inLength - startRoom));
    if (i === lastElbow && endRoom > 0) r = Math.max(0, Math.min(r, outLength - endRoom));
    const ix = Math.sign(point.x - previous.x);
    const iy = Math.sign(point.y - previous.y);
    const ox = Math.sign(next.x - point.x);
    const oy = Math.sign(next.y - point.y);
    parts.push(`L${fmt(point.x - ix * r)} ${fmt(point.y - iy * r)}`);
    parts.push(`Q${fmt(point.x)} ${fmt(point.y)} ${fmt(point.x + ox * r)} ${fmt(point.y + oy * r)}`);
  }
  return parts.join(' ');
}

/** The arrowhead at `tip`, pointing from `from` to `tip`, and the point where its base meets the line. */
function arrowhead(
  tip: Point,
  from: Point,
  head: NonNullable<EdgeStyle['head']>,
  ink: string,
  canvas: string,
): { element: string; base: Point } {
  const length = Math.abs(tip.x - from.x) + Math.abs(tip.y - from.y);
  const dx = length === 0 ? 0 : (tip.x - from.x) / length;
  const dy = length === 0 ? 1 : (tip.y - from.y) / length;
  const base = { x: tip.x - dx * head.length, y: tip.y - dy * head.length };
  const half = head.width / 2;
  const corners = [
    tip,
    { x: base.x - dy * half, y: base.y + dx * half },
    { x: base.x + dy * half, y: base.y - dx * half },
  ];
  const fill = head.fill === 'solid' ? ink : head.fill === 'hollow' ? canvas : 'none';
  const polygon = corners.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(' ');
  return {
    element: `<polygon points="${polygon}" fill="${fill}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/>`,
    base: head.fill === 'open' ? tip : base,
  };
}

/**
 * The SVG elements of one routed edge: its line (shortened under the heads) and its heads. A hub bundle's
 * members (`edge.bundle`) share the port at the bundle's end and their trunk towards it: the line is drawn from
 * that end, so the dash patterns of the members coincide along the trunk, and the shared head is drawn once
 * (`drawnHeads` remembers the bundles whose head is drawn).
 */
function edgeElements(edge: EdgePath, ink: string, canvas: string, drawnHeads: Set<string>): string[] {
  const style = EDGE_STYLES[edge.kind];
  const points = [...edge.points];
  const elements: string[] = [];
  const head = style.head;
  let startRoom = 0;
  let endRoom = 0;
  const shared = edge.bundle;
  if (head !== undefined && edge.heads !== 'none' && points.length >= 2) {
    const tip = points[points.length - 1] as Point;
    const { element, base } = arrowhead(tip, points[points.length - 2] as Point, head, ink, canvas);
    if (shared?.end !== 'target' || !drawnHeads.has(shared.id)) elements.push(element);
    points[points.length - 1] = base;
    endRoom = head.length;
    if (edge.heads === 'both') {
      const start = points[0] as Point;
      const startHead = arrowhead(start, points[1] as Point, head, ink, canvas);
      if (shared?.end !== 'source' || !drawnHeads.has(shared.id)) elements.push(startHead.element);
      points[0] = startHead.base;
      startRoom = head.length;
    }
  }
  if (shared !== undefined) drawnHeads.add(shared.id);
  const dash = style.dash === undefined ? '' : ` stroke-dasharray="${style.dash}"`;
  const caps = head === undefined ? ' stroke-linecap="round"' : '';
  const fromTarget = shared?.end === 'target';
  const path = fromTarget
    ? roundedPath([...points].reverse(), edge.elbowRadius, endRoom, startRoom)
    : roundedPath(points, edge.elbowRadius, startRoom, endRoom);
  elements.unshift(
    `<path d="${path}" fill="none" stroke="${ink}" stroke-width="${String(style.width)}"${dash}${caps} stroke-linejoin="round"><title>${escape(`${edge.from} -${edge.kind}-> ${edge.to}${edge.count > 1 ? ` (${String(edge.count)})` : ''}${shared === undefined ? '' : ` · ${shared.id}`}`)}</title></path>`,
  );
  return elements;
}

export interface DebugSvgOptions {
  readonly theme: Theme;
  /** The caption under the drawing, e.g. "demo M · overview · detail auto". */
  readonly caption: string;
  /** Draw each container's children box and its packing aspect. */
  readonly aspects: boolean;
}

/** The SVG text of a Layout. Deterministic: same Scene, Layout and options, same bytes. */
export function debugSvg(scene: Scene, layout: Layout, options: DebugSvgOptions): string {
  const palette = PALETTES[options.theme];
  const sizing = DEFAULT_SIZING;
  const nodes = new Map<string, SceneNode>();
  const visit = (list: readonly SceneNode[]): void => {
    for (const node of list) {
      nodes.set(node.id, node);
      if (node.type === 'zone') visit(node.children);
    }
  };
  visit(scene.children);

  const footer = 28;
  const { bounds } = layout;
  const width = bounds.width;
  const height = bounds.height + footer;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}" viewBox="${String(bounds.x)} ${String(bounds.y)} ${String(width)} ${String(height)}">`,
    `<title>gcportrait layout debug: ${escape(options.caption)}</title>`,
    `<desc>gcportrait layout debug (not the renderer): ${escape(options.caption)}</desc>`,
    `<rect x="${String(bounds.x)}" y="${String(bounds.y)}" width="${String(width)}" height="${String(height)}" fill="${palette.canvas}"/>`,
  ];

  for (const [id, rect] of Object.entries(layout.rects)) {
    const node = nodes.get(id);
    const label = node?.label ?? id;
    const subtitle = node?.subtitle;
    const [fill, stroke] = tintOf(rect, palette);
    const box = `x="${String(rect.x)}" y="${String(rect.y)}" width="${String(rect.width)}" height="${String(rect.height)}"`;
    if (rect.role === 'zone') {
      const dash = rect.kind === 'region' ? ' stroke-dasharray="4 3"' : '';
      out.push(
        `<rect ${box} rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${zoneStrokeWidth(rect)}"${dash}/>`,
      );
      const size = zoneTitleSizeAt(rect.depth, sizing);
      const baseline = rect.y + rect.headerHeight / 2 + size * 0.35;
      const iconY = rect.y + (rect.headerHeight - sizing.headerIcon) / 2;
      const title = fit(label, TEXT_WEIGHTS.zoneTitle, size, rect.width - 2 * rect.padding - 32);
      const titleWidth = measureText(title, TEXT_WEIGHTS.zoneTitle, size);
      const subtitleRunList =
        subtitle === undefined ? [] : subtitleRuns(`${ZONE_TITLE_SEPARATOR}${subtitle}`);
      const idWidth = subtitleRunList.reduce(
        (sum, run) => sum + measureText(run.text, TEXT_WEIGHTS.zoneTitleId, size, { family: run.family }),
        0,
      );
      const group = sizing.headerIcon + sizing.headerIconGap + titleWidth + idWidth;
      const left = rect.kind === 'folder' ? rect.x + rect.padding : rect.x + (rect.width - group) / 2;
      out.push(
        `<rect x="${String(left)}" y="${String(iconY)}" width="${String(sizing.headerIcon)}" height="${String(sizing.headerIcon)}" rx="4" fill="none" stroke="${palette.muted}" stroke-dasharray="2 2"/>`,
      );
      const textX = left + sizing.headerIcon + sizing.headerIconGap;
      out.push(textElement(textX, baseline, title, { size, weight: 500, fill: palette.ink }));
      // The subtitle after the title: addresses in Roboto Mono, the rest in Roboto (subtitleRuns).
      out.push(
        ...runElements(textX + titleWidth, baseline, subtitleRunList, {
          size,
          weight: 400,
          fill: palette.muted,
          width: idWidth,
        }),
      );
      const badges = node?.type === 'zone' ? node.badges : [];
      let right = rect.x + rect.width - rect.padding;
      for (const badge of [...badges].reverse()) {
        const pill = measureText(badge, 400, sizing.badgeTextSize) + 2 * sizing.badgePaddingX;
        right -= pill;
        out.push(
          `<rect x="${String(right)}" y="${String(rect.y + rect.headerHeight / 2 - 9)}" width="${String(pill)}" height="18" rx="9" fill="${palette.surface}" stroke="${palette.border}"/>`,
        );
        out.push(
          textElement(right + sizing.badgePaddingX, rect.y + rect.headerHeight / 2 + 3.5, badge, {
            size: sizing.badgeTextSize,
            weight: 400,
            fill: palette.muted,
          }),
        );
        right -= sizing.badgeSpacing;
      }
      continue;
    }
    const isCard = rect.role === 'card';
    out.push(
      `<rect ${box} rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${isCard ? '1.5' : '1'}"${rect.role === 'empty' ? ' stroke-dasharray="5 3"' : ''}/>`,
    );
    const iconX = rect.x + sizing.cardPadding;
    // A chip's ⊞ glyph is 16 px with an 8 px gap after it (as the renderer draws it); a card's icon 24 px.
    const chip = rect.role === 'chip';
    const icon = chip ? sizing.chipGlyph : sizing.cardIcon;
    out.push(
      `<rect x="${String(iconX)}" y="${String(rect.y + (rect.height - icon) / 2)}" width="${String(icon)}" height="${String(icon)}" rx="${chip ? '2' : '4'}" fill="none" stroke="${palette.muted}" stroke-dasharray="2 2"/>`,
    );
    const textX = iconX + icon + (chip ? sizing.chipGlyphGap : sizing.cardPadding);
    const room = rect.x + rect.width - sizing.cardPadding - textX;
    const titleText = label;
    const second = rect.role === 'chip' ? chipLine(node, rect.width) : (subtitle ?? '');
    out.push(
      textElement(
        textX,
        rect.y + (second === '' ? 26 : 19),
        fit(titleText, 700, sizing.cardTitleSize, room),
        {
          size: sizing.cardTitleSize,
          weight: 700,
          fill: palette.ink,
        },
      ),
    );
    if (second !== '') {
      // Addresses in Roboto Mono, the rest in Roboto: the runs the layout measured (subtitleRuns).
      const runs = rect.role === 'chip' ? [{ text: second, family: 'sans' as const }] : subtitleRuns(second);
      out.push(
        ...runElements(textX, rect.y + 34, runs, {
          size: sizing.cardSubtitleSize,
          weight: 400,
          fill: palette.muted,
          width: room,
        }),
      );
    }
  }

  const drawnHeads = new Set<string>();
  for (const edge of Object.values(layout.edges))
    out.push(...edgeElements(edge, palette.ink, palette.canvas, drawnHeads));

  if (options.aspects) {
    for (const aspect of packingAspects(layout)) {
      if (aspect.children < 2) continue;
      const children = Object.values(layout.rects).filter((rect) => rect.parent === aspect.id);
      const x = Math.min(...children.map((rect) => rect.x));
      const y = Math.min(...children.map((rect) => rect.y));
      out.push(
        `<rect x="${String(x - 3)}" y="${String(y - 3)}" width="${String(aspect.width + 6)}" height="${String(aspect.height + 6)}" fill="none" stroke="${palette.accent}" stroke-width="1" stroke-dasharray="6 4"/>`,
      );
      const flag = aspect.children >= 4 && aspect.deviation > ASPECT_TOLERANCE ? ' ✗' : '';
      out.push(
        textElement(
          x + aspect.width + 3,
          y + aspect.height + 14,
          `${aspect.aspect.toFixed(2)} / ${aspect.target.toFixed(2)} (${String(aspect.children)}) · fill ${String(Math.round(aspect.fill * 100))} %${flag}`,
          { size: 10.5, weight: 700, fill: palette.accent, anchor: 'end' },
        ),
      );
    }
  }

  const captionY = bounds.y + bounds.height + 18;
  out.push(
    textElement(bounds.x + 24, captionY, `gcportrait layout debug (not the renderer) · ${options.caption}`, {
      size: 11,
      weight: 500,
      fill: palette.muted,
    }),
  );
  out.push('</svg>');
  return `${out.join('\n')}\n`;
}
