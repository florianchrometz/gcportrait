// SPDX-License-Identifier: MIT
/**
 * The options of a rendered export (agents.md, Exports and the render API): which view of a snapshot to draw,
 * in which theme, as SVG, PNG or a draw.io file, at which PNG scale or width, the draw.io file compressed or
 * not and with or without the fonts' stylesheet, and the viewport the `auto` detail level fits. One schema
 * for the render library (`@gcportrait/render`'s `renderView`) and the backend's `POST /api/render`, which
 * adds the data source.
 *
 * The view is either an app link's hash (`{ hash }`, the part after `#`, decoded leniently by `decodeViewSpec` as the
 * app decodes it) or explicit fields, checked strictly with the view schemas: `lens`, `detail`, `focus`, `root`,
 * `filters` (a partial `ViewFilters`) and `flips`, which are zone ids as `pnpm render --flip` takes them (the
 * renderer turns them into the hash's flip tokens). A hash that names a timeline day (`tick`) is refused: a render
 * draws a snapshot's own day. Every message names the field, never the value sent.
 */
import { z } from 'zod';

import { decodeViewSpec } from '../codec/view-hash.js';
import { DetailLevelSchema, LensIdSchema } from './lens.js';
import { TextSchema } from './primitives.js';
import { FocusSchema, VIEW_SPEC_MAX_FLIPS, ViewFiltersSchema } from './view-spec.js';

/** PNG pixels per drawing unit at most (the app's export offers 2× and 3×). */
export const RENDER_MAX_SCALE = 3;
/** The PNG scale when neither `scale` nor `width` is given (the export's default). */
export const RENDER_DEFAULT_SCALE = 2;
/** The longest side of a PNG, and of the viewport, in pixels (the limit of the app's export canvas). */
export const RENDER_MAX_SIDE = 16_384;
/** The viewport `auto` detail fits when none is given: the app's smallest supported canvas (1280×800). */
export const RENDER_DEFAULT_VIEWPORT = Object.freeze({ width: 1280, height: 800 });
/** The longest view hash accepted (an app link's hash is far shorter). */
export const RENDER_MAX_HASH_LENGTH = 8192;

export const RenderThemeSchema = z.enum(['light', 'dark']);
export type RenderTheme = z.infer<typeof RenderThemeSchema>;

/** `drawio`: a `.drawio` file of the same drawing that diagrams.net opens as an editable diagram. */
export const RenderFormatSchema = z.enum(['png', 'svg', 'drawio']);
export type RenderFormat = z.infer<typeof RenderFormatSchema>;

const ViewportSideSchema = z.int().min(1).max(RENDER_MAX_SIDE);

export const RenderViewportSchema = z.strictObject({
  width: ViewportSideSchema,
  height: ViewportSideSchema,
});
export type RenderViewport = z.infer<typeof RenderViewportSchema>;

/** The explicit view fields, every one optional (lens `overview` and detail `auto` by default). */
const EXPLICIT_VIEW_FIELDS = ['lens', 'detail', 'focus', 'root', 'filters', 'flips'] as const;

export const RenderViewSchema = z
  .strictObject({
    /** An app link's view (the part after `#`); excludes every other field. */
    hash: z.string().max(RENDER_MAX_HASH_LENGTH).optional(),
    lens: LensIdSchema.optional(),
    detail: DetailLevelSchema.optional(),
    focus: FocusSchema.optional(),
    /** Drill-in: the id of the container to root the view at. */
    root: TextSchema.optional(),
    filters: ViewFiltersSchema.partial().optional(),
    /** Zone ids to flip (expand a chip, collapse an open zone), as `pnpm render --flip` takes them. */
    flips: z.array(TextSchema).max(VIEW_SPEC_MAX_FLIPS).optional(),
  })
  .superRefine((view, context) => {
    if (view.hash === undefined) return;
    const other = EXPLICIT_VIEW_FIELDS.find((field) => view[field] !== undefined);
    if (other !== undefined)
      context.addIssue({
        code: 'custom',
        path: [other],
        message: 'cannot be given with hash (the hash holds the whole view)',
      });
    if (decodeViewSpec(view.hash).tick !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['hash'],
        message: 'names a timeline day (tick); a render draws the snapshot’s own day',
      });
  });
export type RenderView = z.infer<typeof RenderViewSchema>;

/** The render options without their cross-field rules, for schemas that add fields (the backend's source). */
export const RenderOptionsObjectSchema = z.strictObject({
  view: RenderViewSchema.default({}),
  theme: RenderThemeSchema.default('light'),
  format: RenderFormatSchema.default('png'),
  /** PNG pixels per drawing unit, above 0 and at most 3 (default 2); not with `width`. */
  scale: z.number().gt(0).max(RENDER_MAX_SCALE).optional(),
  /** The PNG's width in pixels, margin included; not with `scale`. */
  width: z.int().min(1).max(RENDER_MAX_SIDE).optional(),
  /** A draw.io file's diagram compressed as draw.io saves it (default true), or as plain XML. */
  compressed: z.boolean().optional(),
  /**
   * A draw.io file's labels name Google Fonts' stylesheet of Roboto and Roboto Mono, which diagrams.net then loads
   * (default true); without it diagrams.net draws the labels in its default font unless Roboto is installed.
   */
  fontSource: z.boolean().optional(),
  /** The canvas the `auto` detail level fits (default 1280×800). */
  viewport: RenderViewportSchema.default(RENDER_DEFAULT_VIEWPORT),
});

/**
 * The cross-field rules of the render options: `scale` or `width`, not both, and neither for an SVG or a draw.io
 * file; `compressed` and `fontSource` for a draw.io file only.
 */
export function checkRenderOptions(
  options: Pick<
    z.infer<typeof RenderOptionsObjectSchema>,
    'format' | 'scale' | 'width' | 'compressed' | 'fontSource'
  >,
  context: z.RefinementCtx,
): void {
  if (options.scale !== undefined && options.width !== undefined)
    context.addIssue({ code: 'custom', path: ['width'], message: 'give scale or width, not both' });
  if (options.format !== 'png')
    for (const field of ['scale', 'width'] as const)
      if (options[field] !== undefined)
        context.addIssue({ code: 'custom', path: [field], message: 'applies to a PNG only' });
  if (options.format !== 'drawio')
    for (const field of ['compressed', 'fontSource'] as const)
      if (options[field] !== undefined)
        context.addIssue({ code: 'custom', path: [field], message: 'applies to a draw.io file only' });
}

export const RenderOptionsSchema = RenderOptionsObjectSchema.superRefine(checkRenderOptions);
/** The options as parsed (defaults filled in). */
export type RenderOptions = z.infer<typeof RenderOptionsSchema>;
/** The options as sent (every field with a default may be left out). */
export type RenderOptionsInput = z.input<typeof RenderOptionsSchema>;
