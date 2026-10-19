// SPDX-License-Identifier: Apache-2.0
/**
 * The committed goldens of demo S, overview lens, detail auto, light theme: the PNG exactly as
 * `pnpm render --fixture S --lens overview` writes it (2×), tolerance-free (the same size and the same RGBA bytes),
 * and the draw.io file as the render library writes it (`drawDrawio`, compressed, no version in its `agent`, so a
 * release does not change it; `pnpm render --drawio` writes the same bytes with its version there), byte for byte.
 * A mismatch leaves the actual file (and the PNG's differences) under out/render/golden-failures/ (git-ignored).
 *
 * Update them deliberately, after a visual change to the layout, the renderer, the fonts, resvg or the draw.io
 * translator: `pnpm --filter @gcportrait/render-cli test:golden:update`, look at the new files, and say why in the PR.
 */
import path from 'node:path';
import { normalizeViewSpec } from '@gcportrait/model';
import { createDemoViews, drawDrawio, drawPng, drawSvg } from '@gcportrait/render';
import { describe, expect, it } from 'vitest';

import { checkGolden, checkTextGolden, REPO_ROOT } from '../src/index.js';

const GOLDEN = path.join(REPO_ROOT, 'e2e/baselines/render/S-overview-auto-light.png');
const DRAWIO_GOLDEN = path.join(REPO_ROOT, 'e2e/baselines/render/S-overview-auto-light.drawio');
const update = process.env.RENDER_UPDATE_GOLDEN === '1';

describe('golden PNG', () => {
  it('draws demo S overview light pixel for pixel as the committed golden', async () => {
    const view = await createDemoViews().prepare(
      'S',
      normalizeViewSpec({ snapshot: 'demo:S', lens: 'overview' }),
    );
    const raster = drawPng(drawSvg(view, 'light'), 'light');
    expect(raster).toMatchObject({ scale: 2, capped: false });
    const result = checkGolden(raster.png, GOLDEN, {
      update,
      failureDir: path.join(REPO_ROOT, 'out/render/golden-failures'),
    });
    expect(result.status, result.message).toBe(update ? 'updated' : 'match');
  });

  it('writes demo S overview light as the committed draw.io file, byte for byte, every time', async () => {
    const views = createDemoViews();
    const spec = normalizeViewSpec({ snapshot: 'demo:S', lens: 'overview' });
    const file = drawDrawio(await views.prepare('S', spec), 'light');
    expect(drawDrawio(await createDemoViews().prepare('S', spec), 'light').text).toBe(file.text);
    const result = checkTextGolden(file.text, DRAWIO_GOLDEN, {
      update,
      failureDir: path.join(REPO_ROOT, 'out/render/golden-failures'),
    });
    expect(result.status, result.message).toBe(update ? 'updated' : 'match');
  });
});
