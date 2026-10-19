// @vitest-environment node
// SPDX-License-Identifier: Apache-2.0
/**
 * Large worker answers as transferred JSON bytes (transfer.ts): which answers are encoded (more than 1 000
 * rects by default, a Layout's or a Scene answer's), and that the page decodes what the structured clone would have
 * given it, for a real Scene answer (with its diff) and Layout of demo M; anything else passes as it is.
 */
import { describe, expect, it } from 'vitest';

import { demoDiagram, demoDiffDiagram } from '../testing/demoScenes';
import { decodeMessage, encodeLarge, rectsOf } from './transfer';

describe('large answers as transferred JSON bytes', () => {
  it('counts the rects of a layout result and of a Scene answer, and nothing else', async () => {
    const { input, report } = await demoDiagram('M', 'overview', 'all');
    expect(rectsOf({ type: 'result', id: 1, key: null, cached: false, layout: input.layout })).toBe(
      Object.keys(input.layout.rects).length,
    );
    const answer = { scene: input.scene, report };
    expect(rectsOf({ type: 'scene', id: 1, answer })).toBe(input.scene.metadata.rectCount);
    expect(rectsOf({ type: 'choices', id: 1, choices: {} })).toBe(0);
    expect(rectsOf(null)).toBe(0);
  });

  it('leaves an answer of at most the threshold as it is (the defaults at 1280 × 800)', async () => {
    const { input } = await demoDiagram('M', 'overview');
    expect(encodeLarge({ type: 'result', id: 1, key: null, cached: false, layout: input.layout })).toBeNull();
    expect(encodeLarge({ type: 'progress', id: 1, stage: 'graph' }, 0)).toBeNull();
  });

  it('encodes, by default, an answer of more than 1 000 rects, and leaves one of 1 000 as it is', () => {
    // The threshold transfer.ts documents: more than 1 000 rects.
    const answer = (rectCount: number) => ({
      type: 'scene',
      id: 1,
      answer: { scene: { metadata: { rectCount } } },
    });
    expect(encodeLarge(answer(1000))).toBeNull();
    expect(encodeLarge(answer(1001))?.type).toBe('encoded');
  });

  it('gives the page what the structured clone gives it: a Layout and a Scene answer with a diff', async () => {
    const { input, report } = await demoDiagram('M', 'overview', 'all');
    const result = { type: 'result', id: 7, key: 'k', cached: false, layout: input.layout };
    const encoded = encodeLarge(result, 100);
    expect(encoded?.type).toBe('encoded');
    expect(encoded?.bytes).toBeInstanceOf(ArrayBuffer);
    expect(decodeMessage(encoded)).toStrictEqual(structuredClone(result));

    const diffed = await demoDiffDiagram('S', 'overview', 'all', '2026-09-16', '2026-09-17');
    const answer = {
      type: 'scene',
      id: 8,
      answer: {
        scene: diffed.input.scene,
        report: diffed.report,
        source: {
          ref: 'demo:S',
          scope: 'example.com',
          readTime: diffed.input.scene.metadata.readTime,
          assets: 96,
        },
        lensTitle: diffed.input.lensTitle,
        icons: diffed.input.icons,
        zoneTypes: diffed.input.zoneTypes,
        consoleLinks: diffed.input.consoleLinks,
        ...(diffed.input.diff === undefined ? {} : { diff: diffed.input.diff }),
      },
    };
    expect(diffed.input.diff).toBeDefined();
    // `toEqual`: JSON drops a field whose value is `undefined` (an icon's `category`), which reads the same.
    expect(decodeMessage(encodeLarge(answer, 10))).toEqual(structuredClone(answer));
    expect(
      decodeMessage(encodeLarge({ type: 'scene', id: 9, answer: { scene: input.scene, report } }, 10)),
    ).toStrictEqual(structuredClone({ type: 'scene', id: 9, answer: { scene: input.scene, report } }));
  });

  it('passes every other message through', () => {
    const message = { type: 'scene', id: 1, answer: { scene: { metadata: { rectCount: 5 } } } };
    expect(decodeMessage(message)).toBe(message);
    expect(decodeMessage(null)).toBeNull();
    const odd = { type: 'encoded', bytes: 'not bytes' };
    expect(decodeMessage(odd)).toBe(odd);
  });
});
