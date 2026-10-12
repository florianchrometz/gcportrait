// SPDX-License-Identifier: MIT
/**
 * The collapse affordance of an open zone, drawn by the interactive canvas only, inside the zone's
 * group and over its header icon: a button (`role="button"`, named "Collapse <zone>") whose face, a ⊟ glyph on
 * a plate (the inverse of a chip's ⊞), the stylesheet (disclosure.css) shows while the pointer is on the zone
 * and on keyboard focus. Activating it (a click, Enter or Space; DiagramCanvas) adds the zone's flip, which
 * XORs its level default, so the zone becomes a chip. It is no tab stop of its own: the highlight painter makes
 * it the drawing's roving tab stop when its zone is the node in question (painter.ts), and the canvas moves
 * focus onto it after a chip was expanded from the keyboard and when the arrow keys or Escape move to its zone
 * (an open zone is an item of the keyboard's navigation, and takes focus here). Exports and baselines
 * never draw it.
 */
import type { ReactElement } from 'react';

import { fmt } from '../geometry/edgePath';
import type { DiagramPalette } from '../theme/tokens';

/** How far the plate reaches past the header icon's box on each side. */
export const COLLAPSE_PLATE_PAD = 2;
const PLATE_RADIUS = 6;
/** The ⊟ glyph: 16 px, like the chip's ⊞. */
const GLYPH = 16;

/** The class and attribute that mark a collapse button and name its zone (DiagramCanvas, painter.ts). */
export const COLLAPSE_CLASS = 'dg-collapse';
export const COLLAPSE_ZONE_ATTRIBUTE = 'data-collapse';

export interface CollapseButtonProps {
  /** The zone's id (its flip is `flipIdOf(id)`). */
  readonly id: string;
  /** The zone's accessible name ("Project: demo-web-1"). */
  readonly name: string;
  /** The header icon's box: top-left corner and size. */
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly palette: DiagramPalette;
}

export function CollapseButton({ id, name, x, y, size, palette }: CollapseButtonProps): ReactElement {
  const plate = size + 2 * COLLAPSE_PLATE_PAD;
  const gx = x + (size - GLYPH) / 2;
  const gy = y + (size - GLYPH) / 2;
  return (
    <g
      className={COLLAPSE_CLASS}
      role="button"
      tabIndex={-1}
      aria-label={`Collapse ${name}`}
      data-collapse={id}
    >
      <title>Collapse</title>
      <g className="dg-collapse-face">
        <rect
          className="dg-collapse-plate"
          x={fmt(x - COLLAPSE_PLATE_PAD)}
          y={fmt(y - COLLAPSE_PLATE_PAD)}
          width={plate}
          height={plate}
          rx={PLATE_RADIUS}
          fill={palette.surface}
          stroke={palette.chipText}
          strokeWidth={1}
        />
        <g className="dg-collapse-glyph" fill="none" stroke={palette.chipText} strokeWidth={1.25}>
          <rect x={fmt(gx + 0.5)} y={fmt(gy + 0.5)} width={GLYPH - 1} height={GLYPH - 1} rx={2} />
          <path d={`M${fmt(gx + 4)} ${fmt(gy + GLYPH / 2)}H${fmt(gx + GLYPH - 4)}`} />
        </g>
      </g>
    </g>
  );
}

/** The zone a collapse button (or anything inside it) belongs to, if the target is one. */
export function collapseZoneOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest(`.${COLLAPSE_CLASS}`)?.getAttribute(COLLAPSE_ZONE_ATTRIBUTE) ?? null;
}

/** The collapse button of a zone in a drawing, if it has one. */
export function collapseButtonOf(root: Element, zoneId: string): Element | null {
  for (const element of Array.from(root.querySelectorAll(`.${COLLAPSE_CLASS}`)))
    if (element.getAttribute(COLLAPSE_ZONE_ATTRIBUTE) === zoneId) return element;
  return null;
}
