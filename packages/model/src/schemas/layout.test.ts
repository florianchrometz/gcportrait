// SPDX-License-Identifier: MIT
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  InsetsSchema,
  LayoutRectSchema,
  PointSchema,
  RectRoleSchema,
  RectSchema,
  type Insets,
  type LayoutRect,
  type Point,
  type Rect,
  type RectRole,
} from '../index.js';

const point = { x: -1.25, y: 0.5 };
const rect = { ...point, width: -2.75, height: 0 };
const insets = { top: -3.5, right: 0, bottom: 4.25, left: -1 };
const layoutRect = {
  ...rect,
  parent: null,
  role: 'card',
  kind: 'card',
  depth: -0.5,
  headerHeight: -2.25,
  padding: -1.5,
  collapsed: true,
} as const;

describe('layout geometry contracts', () => {
  it('preserves finite negative, fractional and zero geometry without role refinements', () => {
    expect(PointSchema.parse(point)).toEqual(point);
    expect(RectSchema.parse(rect)).toEqual(rect);
    expect(InsetsSchema.parse(insets)).toEqual(insets);
    expect(LayoutRectSchema.parse(layoutRect)).toEqual(layoutRect);
  });

  it.each(['zone', 'chip', 'empty', 'card'] as const)('accepts the %s rect role', (role) => {
    expect(RectRoleSchema.parse(role)).toBe(role);
    expect(LayoutRectSchema.parse({ ...layoutRect, role }).role).toBe(role);
  });

  it.each(['folder', 'project', 'vpc', 'subnet', 'region', 'product-container', 'group', 'card'])(
    'accepts the existing %s rect kind',
    (kind) => {
      expect(LayoutRectSchema.parse({ ...layoutRect, kind }).kind).toBe(kind);
    },
  );

  it.each([null, '', 'parent/example.com'])('preserves the parent %j', (parent) => {
    expect(LayoutRectSchema.parse({ ...layoutRect, parent }).parent).toBe(parent);
  });

  it('keeps optional padding absent, or preserves every side when present', () => {
    expect(LayoutRectSchema.parse(layoutRect)).not.toHaveProperty('paddingExtra');
    const padded = { ...layoutRect, paddingExtra: insets };
    expect(LayoutRectSchema.parse(padded)).toEqual(padded);
    expect(LayoutRectSchema.parse(JSON.parse(JSON.stringify(padded)))).toEqual(padded);
  });

  it.each([undefined, null, {}, { ...insets, top: undefined }])(
    'refuses invalid explicit optional padding %j',
    (paddingExtra) => {
      expect(LayoutRectSchema.safeParse({ ...layoutRect, paddingExtra }).success).toBe(false);
    },
  );

  it.each([Number.NaN, Infinity, -Infinity])('refuses non-finite geometry %s', (value) => {
    expect(PointSchema.safeParse({ ...point, x: value }).success).toBe(false);
    expect(RectSchema.safeParse({ ...rect, width: value }).success).toBe(false);
    expect(InsetsSchema.safeParse({ ...insets, top: value }).success).toBe(false);
    expect(LayoutRectSchema.safeParse({ ...layoutRect, depth: value }).success).toBe(false);
  });

  it('refuses missing fields, wrong scalar types and unknown fields', () => {
    expect(PointSchema.safeParse({ x: 1 }).success).toBe(false);
    expect(RectSchema.safeParse({ ...rect, width: '2' }).success).toBe(false);
    expect(InsetsSchema.safeParse({ ...insets, extra: 1 }).success).toBe(false);
    expect(RectRoleSchema.safeParse('unknown')).toMatchObject({ success: false });
    expect(LayoutRectSchema.safeParse({ ...layoutRect, kind: 'unknown' }).success).toBe(false);
    expect(LayoutRectSchema.safeParse({ ...layoutRect, collapsed: 1 }).success).toBe(false);
    expect(LayoutRectSchema.safeParse({ ...layoutRect, extra: 1 }).success).toBe(false);
  });

  it('preserves readonly fields and exact optionality in the inferred types', () => {
    expectTypeOf<Point>().toEqualTypeOf<Readonly<{ x: number; y: number }>>();
    expectTypeOf<Rect>().toEqualTypeOf<Readonly<{ x: number; y: number; width: number; height: number }>>();
    expectTypeOf<Insets>().toEqualTypeOf<
      Readonly<{ top: number; right: number; bottom: number; left: number }>
    >();
    expectTypeOf<RectRole>().toEqualTypeOf<'zone' | 'chip' | 'empty' | 'card'>();
    expectTypeOf<Pick<LayoutRect, 'parent'>>().toEqualTypeOf<Readonly<{ parent: string | null }>>();
    expectTypeOf<Pick<LayoutRect, 'paddingExtra'>>().toEqualTypeOf<Readonly<{ paddingExtra?: Insets }>>();
  });
});
