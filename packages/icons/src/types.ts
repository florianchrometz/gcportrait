// SPDX-License-Identifier: Apache-2.0
/**
 * The shapes of the icon table. They stay inside this package and the app that renders icons, so they are
 * plain TypeScript types rather than `@gcportrait/model` schemas (nothing else crosses a boundary with them).
 */

/**
 * What an icon is: one of Google's product icons (`official`), a gcportrait drawing (`own`), one of Google's
 * category marks standing in for a product without its own icon (`category`), or the last-resort generic cloud
 * mark (`generic`, Google's artwork too).
 */
export type IconKind = 'official' | 'own' | 'category' | 'generic';

/**
 * Where the artwork comes from: Google's core product colour marks (`core`, 512 grid), legacy two-tone console
 * icons (`legacy`, 24 grid), category marks (`category`, 512 grid), or this package's own drawings (`own`).
 */
export type IconSet = 'core' | 'legacy' | 'category' | 'own';

/** One row of the generated table (src/generated/icons.ts). */
export interface IconRecord {
  /** Index into the artwork list. */
  readonly art: number;
  readonly kind: IconKind;
  readonly set: IconSet;
  readonly viewBox: string;
  /** Whether the icon sits on the light plate on dark canvases (style skill §2). */
  readonly plateOnDark: boolean;
  /** The category mark of the product, when the mapping names one. */
  readonly category?: string;
}

/** A resolved icon. */
export interface Icon {
  readonly key: string;
  /**
   * The complete SVG document (`<svg xmlns=… viewBox=…>…</svg>`) without width or height: inline it as is, or
   * place it with `placeIcon`. Never recolour or restyle it.
   */
  readonly svg: string;
  /** `0 0 24 24` or `0 0 512 512`. */
  readonly viewBox: string;
  readonly kind: IconKind;
  readonly set: IconSet;
  /**
   * True for Google's colour and grey marks: on dark canvases they sit on a small light plate (`#FFFFFF` at
   * 92 % opacity, radius 4; style skill §2) so the artwork stays as designed. Two-tone blue icons and the own
   * drawings need none.
   */
  readonly plateOnDark: boolean;
  /** The category mark key of the icon's product, if known. */
  readonly category: string | undefined;
}
