// SPDX-License-Identifier: Apache-2.0
/**
 * The canvas's zoom keys (style skill §13), so that zooming, which the pointer does with the wheel, is the
 * keyboard's too: `+` (or `=`, the same key unshifted on a US layout) zooms in and `-` (or `_`) zooms out by one
 * step about the focused item (camera.ts, `zoomStepTransform`), and `0` fits the whole drawing again, to the part
 * of the canvas an open drawer or sheet leaves in view (DiagramCanvas, `fitRoom`; with none open, the whole canvas, as
 * a new view opens). Matched by the character typed, with whatever Shift, Option or AltGr the layout needed for it;
 * Ctrl or Cmd with them is the browser's page zoom and stays the browser's (keyboard/shortcuts.ts).
 */
import { isShortcutKey } from '../../keyboard/shortcuts';

export type ZoomKey = 'in' | 'out' | 'fit';

const ZOOM_KEYS: Readonly<Record<string, ZoomKey>> = Object.freeze({
  '+': 'in',
  '=': 'in',
  '-': 'out',
  _: 'out',
  '0': 'fit',
});

/** What a key press asks of the camera, or null when it is no zoom key (or someone else's shortcut). */
export function zoomKeyOf(
  event: Pick<
    KeyboardEvent,
    'key' | 'ctrlKey' | 'metaKey' | 'altKey' | 'defaultPrevented' | 'getModifierState'
  >,
): ZoomKey | null {
  if (!Object.hasOwn(ZOOM_KEYS, event.key) || !isShortcutKey(event)) return null;
  return ZOOM_KEYS[event.key] ?? null;
}
