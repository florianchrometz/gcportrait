// SPDX-License-Identifier: MIT
/**
 * `renderView` against the command line's own outputs: the renderer's SVG baselines (e2e/baselines/diagram/,
 * which `pnpm render` reproduces) and the committed golden PNG (e2e/baselines/render/), byte for byte; the
 * view from a hash and from explicit fields; the refused root and focus; the pixel limit; the file name and
 * the title block, which never carries the affiliation line (agents.md, Non-affiliation, brand and legal);
 * the draw.io file, the same drawing translated (its golden is render-cli's).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  RenderOptionsSchema,
  encodeViewSpec,
  normalizeViewSpec,
  type RenderOptionsInput,
} from '@gcportrait/model';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  TAGLINE,
  ViewRefusedError,
  createDemoViews,
  drawDrawio,
  initRasteriser,
  readDrawioFile,
  renderView,
  snapshotFromDemo,
  viewSpecOf,
} from '../src/index.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const baseline = (name: string): string =>
  readFileSync(path.join(REPO_ROOT, 'e2e/baselines/diagram', `${name}.svg`), 'utf8');
const GOLDEN = path.join(REPO_ROOT, 'e2e/baselines/render/S-overview-auto-light.png');

const options = (input: RenderOptionsInput = {}) => RenderOptionsSchema.parse(input);

beforeAll(async () => {
  await initRasteriser();
});

describe('renderView', () => {
  it('draws demo S overview as the CLI does: the baseline SVGs and the golden PNG, byte for byte', async () => {
    const snapshot = await snapshotFromDemo('S');
    const context = { snapshotRef: 'demo:S' } as const;
    for (const theme of ['light', 'dark'] as const) {
      const svg = renderView(snapshot, options({ format: 'svg', theme }), context);
      expect(new TextDecoder().decode(svg.bytes)).toBe(baseline(`S-overview-auto-${theme}`));
      expect(svg.contentType).toBe('image/svg+xml; charset=utf-8');
      expect(svg.fileName).toBe('gcportrait_example.com_overview_20261008T000000Z.svg');
    }
    const png = renderView(snapshot, options(), context);
    expect(png).toMatchObject({
      contentType: 'image/png',
      fileName: 'gcportrait_example.com_overview_20261008T000000Z.png',
      viewHash: 'snapshot=demo:S',
      detailUsed: 'all',
      scale: 2,
      capped: false,
      assets: 96,
    });
    expect(Buffer.from(png.bytes).equals(readFileSync(GOLDEN))).toBe(true);
  });

  it('carries the title block with the tagline and no affiliation line', async () => {
    const svg = new TextDecoder().decode(
      renderView(await snapshotFromDemo('S'), options({ format: 'svg' })).bytes,
    );
    expect(svg).toContain(`>${TAGLINE}</text>`);
    expect(svg).toContain('Drawn with gcportrait.</desc>');
    expect(svg).not.toMatch(/affiliated/i);
  });

  it('takes the view from a hash as the app does, or from explicit fields with zone ids as flips', async () => {
    const snapshot = await snapshotFromDemo('M');
    const fromHash = renderView(
      snapshot,
      options({
        format: 'svg',
        view: { hash: '#snapshot=demo%3AL&lens=networking&detail=networks&selection=x' },
      }),
      { snapshotRef: 'demo:M' },
    );
    const explicit = renderView(
      snapshot,
      options({ format: 'svg', view: { lens: 'networking', detail: 'networks' } }),
      { snapshotRef: 'demo:M' },
    );
    expect(Buffer.from(fromHash.bytes).equals(Buffer.from(explicit.bytes))).toBe(true);
    // The hash's own snapshot is replaced by the source's; selection does not change the drawing.
    expect(explicit.viewHash).toBe('snapshot=demo:M&lens=networking&detail=networks');
    expect(fromHash.viewHash).toBe(`${explicit.viewHash}&selection=x`);
    const zone = '//cloudresourcemanager.googleapis.com/folders/20000000001';
    const spec = viewSpecOf({ flips: [zone], filters: { hideEmptyProjects: true } }, '');
    expect(encodeViewSpec(spec)).toBe(
      encodeViewSpec(
        normalizeViewSpec({
          lens: 'overview',
          flips: [spec.flips[0] ?? ''],
          filters: { hideEmptyProjects: true },
        }),
      ),
    );
    expect(spec.flips).toHaveLength(1);
    expect(spec.flips[0]).not.toBe(zone);
  });

  it('refuses a root that is not in the snapshot and a focus that does not apply', async () => {
    const snapshot = await snapshotFromDemo('S');
    expect(() => renderView(snapshot, options({ format: 'svg', view: { root: 'no-such-node' } }))).toThrow(
      ViewRefusedError,
    );
    expect(() =>
      renderView(
        snapshot,
        options({ format: 'svg', view: { focus: { kind: 'project', params: { project: 'demo-none-1' } } } }),
      ),
    ).toThrow(/^focus: /);
  });

  it('lowers the scale to the pixel limit and says so; that scale gives the same bytes uncapped', async () => {
    const snapshot = await snapshotFromDemo('S');
    const capped = renderView(snapshot, options({ scale: 3 }), { maxPixels: 4_000_000 });
    expect(capped.capped).toBe(true);
    expect((capped.width ?? 0) * (capped.height ?? 0)).toBeLessThanOrEqual(4_000_000);
    const again = renderView(snapshot, options({ scale: capped.scale ?? 0 }));
    expect(again.capped).toBe(false);
    expect(Buffer.from(again.bytes).equals(Buffer.from(capped.bytes))).toBe(true);
    const wide = renderView(snapshot, options({ width: 1000 }));
    expect(wide.width).toBe(1000);
  });

  it('draws a draw.io file of the same view: compressed by default, plain on request, no pixel limit', async () => {
    const snapshot = await snapshotFromDemo('S');
    const context = { snapshotRef: 'demo:S', maxPixels: 1000, version: '1.2.3' } as const;
    const file = renderView(snapshot, options({ format: 'drawio' }), context);
    expect(file).toMatchObject({
      contentType: 'application/vnd.jgraph.mxfile',
      fileName: 'gcportrait_example.com_overview_20261008T000000Z.drawio',
      viewHash: 'snapshot=demo:S',
      detailUsed: 'all',
      assets: 96,
    });
    expect(file.scale).toBeUndefined();
    const text = new TextDecoder().decode(file.bytes);
    const read = readDrawioFile(text);
    expect(read.compressed).toBe(true);
    expect(read.attributes.get('agent')).toBe('gcportrait 1.2.3');
    expect(read.model).toContain(`${TAGLINE}</div>`.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    expect(read.model).not.toMatch(/affiliated/i);
    const plain = renderView(snapshot, options({ format: 'drawio', compressed: false }), context);
    expect(readDrawioFile(new TextDecoder().decode(plain.bytes))).toMatchObject({
      compressed: false,
      model: read.model,
    });
    const unfonted = new TextDecoder().decode(
      renderView(snapshot, options({ format: 'drawio', compressed: false, fontSource: false }), context)
        .bytes,
    );
    expect(unfonted).not.toContain('fontSource=');
    // The library's own drawing of the view, the same bytes.
    const view = await createDemoViews().prepare('S', viewSpecOf({}, 'demo:S'));
    expect(drawDrawio(view, 'light', { version: '1.2.3' }).text).toBe(text);
  });
});
