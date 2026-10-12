// SPDX-License-Identifier: MIT
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { layoutScene } from '../src/index.js';
import { card, scene, zone } from '../src/testing/scenes.js';
import { run } from './debug-svg.js';
import { debugSvg } from './lib/debug-svg.js';

const input = scene([
  zone(
    'f',
    'folder',
    [
      zone('chip', 'project', [], { collapsed: { networks: 2, resources: 39 } }),
      zone('one', 'project', [], { collapsed: { networks: 1, resources: 1 } }),
    ],
    {
      label: 'Platform',
      subtitle: 'folder 20000000001',
      badges: ['1 hidden'],
    },
  ),
  zone('p', 'project', [
    zone('r', 'region', [card('a', 'web-1', '10.0.0.2 · <running> & "ok"')]),
    zone('e', 'vpc', []),
  ]),
  zone('x', 'product-container', [card('b', 'b'.repeat(60))]),
  zone('g', 'group', [card('c')]),
]);
const layout = layoutScene(input);
const out = mkdtempSync(path.join(tmpdir(), 'layout-debug-svg-'));
afterAll(() => {
  rmSync(out, { recursive: true, force: true });
});

describe('debugSvg', () => {
  it('draws every rect with its label, in both themes, with no affiliation line (ADR 0018)', () => {
    for (const theme of ['light', 'dark'] as const) {
      const svg = debugSvg(input, layout, { theme, caption: 'test', aspects: true });
      expect(svg).not.toMatch(/affiliated/i);
      expect(svg).toContain('<desc>gcportrait layout debug (not the renderer): test</desc>');
      expect(svg.match(/<rect /g)?.length).toBeGreaterThan(Object.keys(layout.rects).length);
      expect(svg).toContain('Platform');
      expect(svg).toContain('2 networks · '); // the count line, cut to fit the 148 px chip
      expect(svg).toContain('>1 network · ');
      expect(svg).not.toContain('1 networks');
      expect(svg).toContain('&lt;running&gt; &amp; &quot;ok&quot;');
      expect(svg).toContain('…'); // the long card label is cut to fit
      expect(svg).toContain(theme === 'light' ? '#A8C7FA' : '#1C3A5E'); // project tint
      // Zone strokes (skill gcp-diagram-style §4): folders, regions, product containers and groups 1 px;
      // projects and VPCs 1.5 px.
      const folder = theme === 'light' ? '#9AA0A6' : '#5F6368';
      expect(svg).toMatch(new RegExp(`rx="10" fill="[^"]+" stroke="${folder}" stroke-width="1"/>`));
      expect(svg).toMatch(/rx="10" fill="#(?:A8C7FA|1C3A5E)" stroke="[^"]+" stroke-width="1\.5"\/>/);
      expect(svg).not.toMatch(new RegExp(`stroke="${folder}" stroke-width="1\\.5"`));
      expect(debugSvg(input, layout, { theme, caption: 'test', aspects: true })).toBe(svg);
    }
    expect(debugSvg(input, layout, { theme: 'light', caption: 'test', aspects: false })).not.toContain(
      '/ 1.60',
    );
  });
});

describe('the debug-svg command', () => {
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const writeErr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  afterAll(() => {
    write.mockRestore();
    writeErr.mockRestore();
  });

  it('prints its usage, with no affiliation line (ADR 0018: footers and long-form texts only)', () => {
    expect(run(['--help'])).toBe(0);
    expect(write).toHaveBeenCalledWith(expect.stringContaining('Usage:'));
    expect(write).not.toHaveBeenCalledWith(expect.stringMatching(/affiliated/i));
  });

  it('refuses invalid arguments', () => {
    expect(run(['--fixture', 'XL'])).toBe(2);
    expect(run(['--lens', 'nope'])).toBe(2);
    expect(run(['--theme', 'sepia'])).toBe(2);
  });

  it('writes an SVG and a PNG of a demo layout', () => {
    expect(
      run(['--fixture', 'S', '--lens', 'networking', '--theme', 'both', '--aspects', '--out', out]),
    ).toBe(0);
    for (const theme of ['light', 'dark']) {
      const svg = readFileSync(path.join(out, `S-networking-auto-${theme}.svg`), 'utf8');
      expect(svg).not.toMatch(/affiliated/i);
      expect(svg).toContain('gcportrait layout debug (not the renderer)');
      const png = readFileSync(path.join(out, `S-networking-auto-${theme}.png`));
      expect(png.subarray(1, 4).toString()).toBe('PNG');
    }
    expect(run(['--fixture', 'S', '--lens', 'overview', '--no-png', '--out', out])).toBe(0);
    expect(readFileSync(path.join(out, 'S-overview-auto-light.svg'), 'utf8')).toContain('<svg');
  });

  it('takes a relative --out from the directory the command was started in (INIT_CWD), else the cwd', () => {
    const started = process.env.INIT_CWD;
    try {
      process.env.INIT_CWD = out;
      expect(run(['--fixture', 'S', '--no-png', '--out', 'relative'])).toBe(0);
      expect(readFileSync(path.join(out, 'relative', 'S-overview-auto-light.svg'), 'utf8')).toContain('<svg');
      delete process.env.INIT_CWD;
      expect(run(['--fixture', 'S', '--no-png', '--out', path.join(out, 'absolute')])).toBe(0);
      expect(readFileSync(path.join(out, 'absolute', 'S-overview-auto-light.svg'), 'utf8')).toContain('<svg');
    } finally {
      if (started === undefined) delete process.env.INIT_CWD;
      else process.env.INIT_CWD = started;
    }
  });
});
