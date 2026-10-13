// SPDX-License-Identifier: MIT
/**
 * The diagram as a standalone `<svg>` document (skill gcp-diagram-style §8): sized to the whole drawing, with
 * `<title>` and `<desc>` naming the scope, the lens and the read time, the legend and the title block (the
 * canvas's three lines; the non-affiliation statement is in the app footer, never in a drawing), and every colour as
 * an attribute of the chosen theme. The snapshot baselines are this markup; the headless renderer and the export
 * start from it. With `selection`, the node is drawn selected with its trace (the selected-state baselines); exports
 * never pass one.
 */
import type { ReactElement } from 'react';

import { WORDMARK } from '../branding';
import { descriptionText, sincePhrase } from './diff/words';
import { DiagramDrawing, planDrawing, type DrawingOptions } from './Drawing';
import { fmt } from './geometry/edgePath';
import type { DiagramModel } from './model';
import { formatReadTime } from './titleBlock';

export type StaticOptions = Omit<DrawingOptions, 'interactive' | 'overlays'> & {
  /** Exports always carry the legend and the title block; tests may leave them out. Default true. */
  readonly overlays?: boolean;
};

/**
 * The `<title>` and `<desc>` text of a diagram, the same for the canvas, the baselines and the export (one
 * wording). The description reads on its own (an image viewer or an editor shows it without the title):
 * the scope, the lens, the read time at the viewer's offset, a timeline day's changes when it was compared with
 * another day ("Changes since 2026-09-07: 1 added, 1 removed, 1 changed.") and what drew it. Neutral
 * metadata only: no affiliation sentence (agents.md, Non-affiliation, brand and legal).
 */
export function documentText(model: DiagramModel, utcOffsetMinutes: number): { title: string; desc: string } {
  const { metadata } = model.input.scene;
  const lens = model.input.lensTitle;
  const read = formatReadTime(metadata.readTime, utcOffsetMinutes);
  const { diff } = model;
  const changes =
    diff === null
      ? ''
      : `${descriptionText(diff.totals, sincePhrase(diff.since, diff.forward, utcOffsetMinutes))} `;
  return {
    title: `${WORDMARK} diagram of ${metadata.rootLabel}, ${lens} lens`,
    desc: `${metadata.rootLabel}, ${lens} lens, read ${read}. ${changes}Drawn with ${WORDMARK}.`,
  };
}

export function DiagramSvg({
  model,
  options,
}: {
  model: DiagramModel;
  options: StaticOptions;
}): ReactElement {
  const drawingOptions: DrawingOptions = {
    ...options,
    overlays: options.overlays ?? true,
    interactive: false,
  };
  const plan = planDrawing(model, drawingOptions);
  const { frame } = plan;
  const text = documentText(model, options.utcOffsetMinutes);
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={fmt(frame.width)}
      height={fmt(frame.height)}
      viewBox={`${fmt(frame.x)} ${fmt(frame.y)} ${fmt(frame.width)} ${fmt(frame.height)}`}
      data-theme={options.theme}
    >
      <title>{text.title}</title>
      <desc>{text.desc}</desc>
      <DiagramDrawing model={model} options={drawingOptions} plan={plan} />
    </svg>
  );
}
