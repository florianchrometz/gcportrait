// SPDX-License-Identifier: Apache-2.0
import {
  RENDER_DEFAULT_SCALE,
  RENDER_PNG_LIMITS,
  RENDER_PNG_MARGIN,
  type PngGeometry,
  type PngGeometryOptions,
  type RenderViewport,
} from '@gcportrait/model';

export class PngGeometryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PngGeometryError';
  }
}

export function pngGeometry(frame: RenderViewport, options: PngGeometryOptions = {}): PngGeometry {
  const margin = options.margin ?? RENDER_PNG_MARGIN;
  const area = Math.min(RENDER_PNG_LIMITS.area, options.maxPixels ?? RENDER_PNG_LIMITS.area);
  const side = Math.min(RENDER_PNG_LIMITS.side, options.maxSide ?? RENDER_PNG_LIMITS.side);
  if (!(area >= 1)) throw new PngGeometryError('The pixel limit must be positive.');
  if (!(side >= 1)) throw new PngGeometryError('The side limit must be positive.');
  if (!Number.isFinite(margin) || margin < 0)
    throw new PngGeometryError('The PNG margin must be nonnegative.');
  if (![frame.width, frame.height].every((value) => Number.isFinite(value) && value > 0)) {
    throw new PngGeometryError('The PNG frame must have a positive finite size.');
  }
  const outerWidth = frame.width + 2 * margin;
  const outerHeight = frame.height + 2 * margin;
  const requested =
    options.width === undefined ? (options.scale ?? RENDER_DEFAULT_SCALE) : options.width / outerWidth;
  if (!(requested > 0) || !Number.isFinite(requested)) {
    throw new PngGeometryError('The scale must be positive.');
  }
  const sizeAt = (scale: number): { width: number; height: number } => ({
    width: Math.max(1, Math.ceil(outerWidth * scale - 1e-9)),
    height: Math.max(1, Math.ceil(outerHeight * scale - 1e-9)),
  });
  const fits = (scale: number): boolean => {
    const { width, height } = sizeAt(scale);
    return width <= side && height <= side && width * height <= area;
  };
  if (fits(requested)) {
    const size = sizeAt(requested);
    if (![size.width / requested, size.height / requested].every(Number.isFinite)) {
      throw new PngGeometryError(
        'The requested PNG scale cannot be represented. Choose a larger scale, or export SVG or draw.io.',
      );
    }
    return { ...size, scale: requested, margin, reduced: false };
  }
  const bound = Math.min(side / outerWidth, side / outerHeight, Math.sqrt(area / (outerWidth * outerHeight)));
  let scale = Math.floor(bound * 100) / 100;
  while (scale > 0.01 && !fits(scale)) scale = Math.round((scale - 0.01) * 100) / 100;
  if (!(scale > 0) || !fits(scale)) {
    throw new PngGeometryError(
      'This diagram cannot fit within the PNG size limits. Export SVG or draw.io, or narrow the view.',
    );
  }
  return { ...sizeAt(scale), scale, margin, reduced: true };
}
