// SPDX-License-Identifier: MIT
/**
 * The export's drawing: `DiagramSvg` (the same component the snapshot baselines and the headless renderer
 * draw) rendered by React into a detached element, in the export's theme and always with the legend and the
 * title block, whatever the canvas shows. The canvas itself is in the app's theme and may hide both, so the
 * export never re-colours or patches it; it draws the view once more. Nothing is attached to the document, so
 * the page, its ids and its accessibility tree are untouched.
 */
import type { ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

import { DiagramSvg } from '../diagram/DiagramSvg';
import type { DiagramModel } from '../diagram/model';
import type { DiagramTheme } from '../diagram/theme/tokens';

/**
 * Renders the standalone drawing, hands its live `<svg>` to `use` (which must not keep it: the element is
 * unmounted when `use` returns) and returns what `use` returns.
 */
export function withStandaloneSvg<T>(
  model: DiagramModel,
  options: { readonly theme: DiagramTheme; readonly utcOffsetMinutes: number },
  use: (svg: SVGSVGElement) => T,
): T {
  const host = document.createElement('div');
  const root = createRoot(host);
  try {
    const element: ReactElement = (
      <DiagramSvg
        model={model}
        options={{ theme: options.theme, utcOffsetMinutes: options.utcOffsetMinutes, overlays: true }}
      />
    );
    flushSync(() => {
      root.render(element);
    });
    const svg = host.firstElementChild;
    if (!(svg instanceof SVGSVGElement)) throw new Error('The diagram could not be drawn for the export.');
    return use(svg);
  } finally {
    root.unmount();
  }
}
