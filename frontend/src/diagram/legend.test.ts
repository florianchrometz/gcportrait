// SPDX-License-Identifier: MIT
import { layoutScene, measureText } from '@gcportrait/layout';
import { describe, expect, it } from 'vitest';

import {
  composeLegend,
  LEGEND,
  LEGEND_LABEL_MAX,
  placeLegend,
  relationLabel,
  securesLabel,
  TRACE_LEGEND_ROWS,
} from './legend';
import { diagramIcons } from './iconTable';
import { buildDiagramModel } from './model';
import { card, denseCards, denseEdges, modelOf, scene, smallScene, zone } from './testing/scenes';

describe('relationLabel', () => {
  it("names a kind with the model's meaning, up to its examples", () => {
    expect(relationLabel('routes')).toBe('routes — traffic path');
    expect(relationLabel('shares')).toBe('shares — Shared VPC');
    expect(relationLabel('peers')).toBe('peers — symmetric peering');
  });
});

describe('composeLegend (style skill §7: only what is on screen)', () => {
  it('lists the tints present, the resource and chip samples, and the relation kinds drawn, in a fixed order', () => {
    const model = modelOf(
      smallScene([
        ['run/web', 'run/api', 'uses'],
        ['run/jobs', 'run/web', 'routes'],
        ['clusters/gke', 'networks/vpc', 'secures'],
      ]),
    );
    expect(composeLegend(model).map((row) => row.label)).toEqual([
      'Folder',
      'Project',
      'VPC network',
      'Subnetwork',
      'Nested container',
      'Resource',
      'Collapsed zone',
      'routes — traffic path',
      'uses — generic reference',
      'secures — retail-prod',
    ]);
    // The chip sample takes the tint of the chips drawn (here the collapsed project), as chips do.
    expect(composeLegend(model).find((row) => row.type === 'chip')).toEqual({
      type: 'chip',
      tint: 'project',
      label: 'Collapsed zone',
    });
  });

  it('gives the chip sample the tint most of the chips have, ties to the outer kind', () => {
    const chip = (id: string, kind: 'folder' | 'project'): ReturnType<typeof zone> =>
      zone(id, kind, id, [], { collapsed: { resources: 3 } });
    const tintOf = (children: ReturnType<typeof zone>[]): unknown =>
      composeLegend(modelOf(scene(children))).find((row) => row.type === 'chip');
    expect(
      tintOf([chip('folders/a', 'folder'), chip('projects/b', 'project'), chip('projects/c', 'project')]),
    ).toEqual({ type: 'chip', tint: 'project', label: 'Collapsed zone' });
    expect(tintOf([chip('projects/b', 'project'), chip('folders/a', 'folder')])).toEqual({
      type: 'chip',
      tint: 'folder',
      label: 'Collapsed zone',
    });
  });

  it('leaves out everything that is not drawn', () => {
    const model = modelOf(scene([zone('projects/p', 'project', 'p', [card('run/a', 'a')])]));
    expect(composeLegend(model).map((row) => row.type)).toEqual(['zone', 'resource']);
  });

  it('adds "dim = not focused" only in dim mode, and tells nested containers from the others by depth', () => {
    const model = modelOf(
      scene(
        [
          zone('folders/f', 'folder', 'f', [
            zone('projects/p', 'project', 'p', [zone('clusters/k', 'product-container', 'k', denseCards())]),
          ]),
        ],
        denseEdges(31),
      ),
    );
    const rows = composeLegend(model);
    expect(rows.map((row) => row.label)).toContain('Nested container');
    expect(rows.map((row) => row.label)).not.toContain('Product container');
    expect(rows[rows.length - 1]).toEqual({ type: 'dim', label: 'dim = not focused' });
  });
});

describe('placeLegend', () => {
  it('fills columns of six rows, top to bottom, left to right, deterministically', () => {
    const rows = composeLegend(
      modelOf(
        smallScene([
          ['run/web', 'run/api', 'uses'],
          ['run/jobs', 'run/web', 'routes'],
        ]),
      ),
    );
    const placed = placeLegend(rows);
    expect(placed.rows.map(({ x, y }) => [x, y])).toEqual(placeLegend(rows).rows.map(({ x, y }) => [x, y]));
    const first = placed.rows.slice(0, LEGEND.rowsPerColumn);
    expect(new Set(first.map((row) => row.x)).size).toBe(1);
    expect(first.map((row) => row.y)).toEqual(
      first.map((_, index) => LEGEND.padding + LEGEND.titleHeight + index * LEGEND.rowHeight),
    );
    expect(placed.rows[LEGEND.rowsPerColumn]?.x).toBeGreaterThan(first[0]?.x ?? 0);
    expect(placed.width).toBeGreaterThan(placed.rows[placed.rows.length - 1]?.x ?? 0);
    expect(placed.height).toBe(
      LEGEND.padding + LEGEND.titleHeight + LEGEND.rowsPerColumn * LEGEND.rowHeight + LEGEND.padding - 4,
    );
  });
});

describe('the secures row and titles name the policy', () => {
  it('names one policy by its label, a chip as the policies in it, several by their number', () => {
    const model = modelOf(
      smallScene([
        ['clusters/gke', 'networks/vpc', 'secures'],
        ['run/jobs', 'subnets/a', 'secures'],
      ]),
    );
    expect(securesLabel(model, ['clusters/gke'])).toBe('secures — retail-prod');
    expect(securesLabel(model, ['clusters/gke', 'clusters/gke'])).toBe('secures — retail-prod');
    expect(securesLabel(model, ['projects/data'])).toBe('secures — policies in Analytics');
    expect(securesLabel(model, ['clusters/gke', 'run/jobs'])).toBe('secures — 2 policies');
    expect(composeLegend(model).find((row) => row.type === 'overlay')?.label).toBe('secures — 2 policies');
  });

  it('cuts a long policy name at a card’s widest with an ellipsis, keeping the full name as its title', () => {
    const long = 'org-wide-baseline-for-every-production-workload-in-europe-and-the-americas';
    const model = modelOf(
      scene(
        [
          zone('projects/p', 'project', 'p', [
            card('policies/long', long),
            zone('networks/v', 'vpc', 'v', [card('run/a', 'a')]),
          ]),
        ],
        [{ from: 'policies/long', to: 'networks/v', kind: 'secures' }],
      ),
    );
    const row = composeLegend(model).find((entry) => entry.type === 'overlay');
    expect(row?.type === 'overlay' ? row.title : undefined).toBe(`secures — ${long}`);
    expect(row?.label.endsWith('…')).toBe(true);
    expect(measureText(row?.label ?? '', 400, LEGEND.fontSize)).toBeLessThanOrEqual(LEGEND_LABEL_MAX);
    // A short one stays whole and has no title.
    const short = modelOf(smallScene([['clusters/gke', 'networks/vpc', 'secures']]));
    expect(composeLegend(short).find((entry) => entry.type === 'overlay')).toEqual({
      type: 'overlay',
      label: 'secures — retail-prod',
    });
  });
});

describe('the trace rows (skill §6)', () => {
  it('are "selected", "trace" and "path to root", in their own column to the right', () => {
    expect(TRACE_LEGEND_ROWS.map((row) => row.label)).toEqual(['selected', 'trace', 'path to root']);
    const rows = composeLegend(modelOf(smallScene([['run/web', 'run/api', 'uses']])));
    const plain = placeLegend(rows);
    expect(plain.trace).toBeNull();
    const placed = placeLegend(rows, TRACE_LEGEND_ROWS);
    expect(placed.rows).toEqual(plain.rows);
    expect(placed.width).toBe(plain.width);
    const right = Math.max(...placed.rows.map((row) => row.x));
    expect(placed.trace?.rows.map((row) => row.row.label)).toEqual(['selected', 'trace', 'path to root']);
    expect(Math.min(...(placed.trace?.rows ?? []).map((row) => row.x))).toBeGreaterThan(right);
    expect(placed.trace?.width).toBeGreaterThan(placed.width);
    expect(placed.trace?.height).toBe(placed.height);
  });

  it('give a two-row legend a taller panel with the column', () => {
    const rows = composeLegend(modelOf(scene([zone('projects/p', 'project', 'p', [card('run/a', 'a')])])));
    expect(rows).toHaveLength(2);
    const placed = placeLegend(rows, TRACE_LEGEND_ROWS);
    expect(placed.trace?.height).toBe(placed.height + LEGEND.rowHeight);
  });
});

describe('the timeline markers’ rows (skill §6, §7)', () => {
  const source = smallScene([['run/web', 'run/api', 'uses']]);
  const since = { tick: '2026-09-07', readTime: '2026-09-07T00:00:00Z' } as const;
  const withDiff = (diff: Parameters<typeof buildDiagramModel>[0]['diff']) =>
    buildDiagramModel({
      scene: source,
      layout: layoutScene(source),
      lensTitle: 'Overview',
      icons: diagramIcons(source),
      ...(diff === undefined ? {} : { diff }),
    });

  it('come last, one per marker drawn, naming the day compared with at the viewer’s offset', () => {
    const model = withDiff({
      since,
      added: ['run/api'],
      removed: ['run/gone'],
      changed: ['run/web'],
      ghosts: {},
      earlier: {},
      inside: {},
    });
    const rows = composeLegend(model, 0);
    expect(rows.slice(-2)).toEqual([
      { type: 'added', label: 'added since 2026-09-07' },
      { type: 'changed', label: 'changed since 2026-09-07' },
    ]);
    // No ghost is drawn (run/gone is in no Scene), so no "removed" row; at UTC−5 the day is the 6th.
    expect(composeLegend(model, -300).at(-1)).toEqual({ type: 'changed', label: 'changed since 2026-09-06' });
  });

  it('are absent without a diff, and with a diff that draws no marker', () => {
    const plain = composeLegend(withDiff(undefined));
    expect(
      plain.some((row) => row.type === 'added' || row.type === 'removed' || row.type === 'changed'),
    ).toBe(false);
    const quiet = composeLegend(
      withDiff({ since, added: [], removed: ['x/y'], changed: [], ghosts: {}, earlier: {}, inside: {} }),
    );
    expect(
      quiet.some((row) => row.type === 'added' || row.type === 'removed' || row.type === 'changed'),
    ).toBe(false);
  });
});
