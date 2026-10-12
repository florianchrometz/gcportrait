// @vitest-environment node
// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';

import { EMBEDDED_FACES, fontFaceCss } from './fonts';

describe('the embedded fonts', () => {
  it('are the faces the diagram uses: Roboto 400, 500, 700 and Roboto Mono 400, latin subset, woff2', () => {
    expect(EMBEDDED_FACES.map((face) => `${face.family} ${String(face.weight)}`)).toEqual([
      'Roboto 400',
      'Roboto 500',
      'Roboto 700',
      'Roboto Mono 400',
    ]);
    for (const face of EMBEDDED_FACES) expect(face.url).toMatch(/latin-\d00-normal\.woff2/);
  });

  it('become one @font-face rule per face with the loaded data URI', async () => {
    const asked: string[] = [];
    const css = await fontFaceCss((url) => {
      asked.push(url);
      return Promise.resolve(`data:font/woff2;base64,${String(asked.length)}`);
    });
    expect(asked).toEqual(EMBEDDED_FACES.map((face) => face.url));
    const rules = css.split('\n');
    expect(rules).toHaveLength(4);
    expect(rules[0]).toBe(
      "@font-face { font-family: 'Roboto'; font-style: normal; font-weight: 400; src: url(data:font/woff2;base64,1) format('woff2'); }",
    );
    expect(rules[3]).toContain("font-family: 'Roboto Mono'; font-style: normal; font-weight: 400;");
  });
});
