// SPDX-License-Identifier: MIT
/**
 * The camera of a canvas on the page: the transform the canvas (DiagramCanvas.tsx) shows its drawing through, which it
 * keeps itself and publishes here, by its `<svg>`, for as long as it is mounted. The export's "current viewport" reads
 * it (export/source.ts), and the tests read it and move it as a person's pan or zoom does.
 */
import { IDENTITY_CAMERA, type CameraTransform } from './viewport';

/** What a canvas publishes of its camera. */
export interface CanvasCamera {
  /** The camera now. */
  readonly get: () => CameraTransform;
  /** Moves the camera to `to` at once, as the person's own pan or zoom does: a glide on its way stops where it is. */
  readonly moveTo: (to: CameraTransform) => void;
}

const published = new WeakMap<SVGSVGElement, CanvasCamera>();

/** Publishes the camera of the canvas `svg`; answers how to take it back again (the canvas going away). */
export function publishCamera(svg: SVGSVGElement, camera: CanvasCamera): () => void {
  published.set(svg, camera);
  return () => {
    if (published.get(svg) === camera) published.delete(svg);
  };
}

/** The camera the canvas `svg` publishes, or null while none does (not mounted, or no canvas's `<svg>`). */
export function canvasCamera(svg: SVGSVGElement): CanvasCamera | null {
  return published.get(svg) ?? null;
}

/** The camera `svg` shows its drawing through now: the identity for an `<svg>` no canvas publishes a camera for. */
export function cameraOf(svg: SVGSVGElement): CameraTransform {
  return published.get(svg)?.get() ?? IDENTITY_CAMERA;
}
