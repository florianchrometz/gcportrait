// SPDX-License-Identifier: MIT
/**
 * The timeline markers' painter (marks.ts; skill gcp-diagram-style §6): which rects get the added outline
 * (the outermost of an added subtree), the changed dot (changed nodes, and chips with changes inside) or are ghosts,
 * which ghosts are drawn as overlays (the earlier day's overlay zones), and where the outline and the dot go. The
 * words they use are words.test.ts's.
 */
import { layoutScene } from '@gcportrait/layout';
import { describe, expect, it } from 'vitest';

import { ringBox, roundedRectPath } from '../geometry/rings';
import { card, scene, zone } from '../testing/scenes';
import { addedPathData, changedDotCentre, diffMarks } from './marks';
import type { TickDiff } from './types';

const SINCE = { tick: '2026-09-07', readTime: '2026-09-07T00:00:00Z' } as const;

/** A project with a new network (and what it holds), a changed card, a ghost card, and a chip with changes inside. */
function fixture() {
  const source = scene([
    zone('folders/1', 'folder', 'Platform', [
      zone('projects/web', 'project', 'Retail web', [
        zone('networks/vpc', 'vpc', 'vpc-prod', [
          zone('subnets/a', 'subnet', 'subnet-a', [
            card('run/api', 'orders-api'),
            card('run/web', 'storefront'),
          ]),
        ]),
        card('run/jobs', 'batch-jobs'),
        card('run/old', 'old-service'),
      ]),
      zone('projects/data', 'project', 'Analytics', [], { collapsed: { networks: 2, resources: 39 } }),
    ]),
  ]);
  const diff: TickDiff = {
    since: SINCE,
    added: ['networks/vpc', 'run/api', 'run/web', 'subnets/a'],
    removed: ['run/old', 'x/one', 'x/two'],
    changed: ['projects/web', 'run/jobs'],
    ghosts: { 'run/old': 'removed' },
    earlier: {},
    inside: {
      'projects/data': { added: 0, removed: 2, changed: 1 },
      'projects/web': { added: 1, removed: 0, changed: 0 },
    },
  };
  return { layout: layoutScene(source), diff };
}

describe('which rects get which marker', () => {
  it('draws no markers without a diff', () => {
    expect(diffMarks(undefined, fixture().layout, '2026-10-08T00:00:00Z')).toBeNull();
  });

  it('outlines the outermost node of an added subtree, and names every added node as added', () => {
    const { layout, diff } = fixture();
    const marks = diffMarks(diff, layout, '2026-10-08T00:00:00Z');
    expect(marks?.added).toEqual(['networks/vpc']);
    for (const id of diff.added) expect(marks?.status.get(id), id).toBe('added');
  });

  it('dots changed nodes and chips with changes inside, in paint order; an open zone counts no inside', () => {
    const { layout, diff } = fixture();
    const marks = diffMarks(diff, layout, '2026-10-08T00:00:00Z');
    const order = Object.keys(layout.rects);
    const expected = ['projects/web', 'run/jobs', 'projects/data'].sort(
      (a, b) => order.indexOf(a) - order.indexOf(b),
    );
    expect(marks?.changed).toEqual(expected);
    expect(marks?.status.get('run/jobs')).toBe('changed');
    expect(marks?.status.has('projects/data')).toBe(false);
    expect(marks?.inside.get('projects/data')).toEqual({ added: 0, removed: 2, changed: 1 });
    // projects/web is drawn open: what changed inside it carries its own markers.
    expect(marks?.inside.has('projects/web')).toBe(false);
  });

  it('keeps ghosts apart from the markers, with their reason, and counts the whole diff', () => {
    const { layout, diff } = fixture();
    const marks = diffMarks(diff, layout, '2026-10-08T00:00:00Z');
    expect([...(marks?.ghosts ?? [])]).toEqual([['run/old', 'removed']]);
    expect(marks?.added).not.toContain('run/old');
    expect(marks?.changed).not.toContain('run/old');
    expect(marks?.totals).toEqual({ added: 4, removed: 3, changed: 2 });
  });

  it('draws the ghost of a zone the earlier day drew as the view’s overlay as an overlay, and no other', () => {
    // A perimeter drawn around a project the day before, both removed, beside a folder that is still there.
    const source = scene([
      zone('perimeters/gone', 'product-container', 'data-perimeter', [
        zone('projects/gone', 'project', 'Retail services', [card('run/gone', 'orders-api')]),
      ]),
      zone('folders/1', 'folder', 'Platform', [card('run/kept', 'storefront')]),
    ]);
    const earlier = (overlay: boolean, parent: string | null) =>
      ({ kind: 'project', parent, overlay, collapsed: false, empty: false }) as const;
    const diff: TickDiff = {
      since: SINCE,
      added: [],
      removed: ['perimeters/gone', 'projects/gone', 'run/gone'],
      changed: [],
      ghosts: { 'perimeters/gone': 'removed', 'projects/gone': 'removed', 'run/gone': 'removed' },
      earlier: {
        'perimeters/gone': { ...earlier(true, null), kind: 'product-container' },
        'projects/gone': earlier(false, 'perimeters/gone'),
        // A zone that is no ghost, even one marked as an overlay, is drawn as the drawn day says.
        'folders/1': { ...earlier(true, null), kind: 'folder' },
      },
      inside: {},
    };
    const marks = diffMarks(diff, layoutScene(source), '2026-10-08T00:00:00Z');
    expect(marks?.overlays).toEqual(['perimeters/gone']);
    expect(
      diffMarks({ ...diff, earlier: {} }, layoutScene(source), '2026-10-08T00:00:00Z')?.overlays,
    ).toEqual([]);
  });

  it('says whether the day compared with is earlier (since) or later (compared with)', () => {
    const { layout, diff } = fixture();
    expect(diffMarks(diff, layout, '2026-09-08T00:00:00Z')?.forward).toBe(true);
    const later = { ...diff, since: { tick: '2026-09-09', readTime: '2026-09-09T00:00:00Z' } };
    expect(diffMarks(later, layout, '2026-09-08T00:00:00Z')?.forward).toBe(false);
  });
});

describe('where the markers go', () => {
  const cardRect = { x: 10, y: 20, width: 100, height: 44, role: 'card' } as const;
  const zoneRect = { x: 0, y: 0, width: 300, height: 200, role: 'zone' } as const;

  it('puts the added outline 8 px outside the border, its corners grown to match', () => {
    expect(addedPathData([cardRect])).toBe(roundedRectPath(ringBox(cardRect, 8), 16));
    expect(addedPathData([cardRect]).startsWith('M18 12H102A16 16 0 0 1 118 28')).toBe(true);
    expect(addedPathData([zoneRect])).toBe(roundedRectPath(ringBox(zoneRect, 8), 18));
  });

  it('centres the changed dot on the middle of the rounded top-right corner', () => {
    const inset = (radius: number): number => radius - radius / Math.SQRT2;
    const onCard = changedDotCentre(cardRect);
    expect(onCard.x).toBeCloseTo(110 - inset(8), 6);
    expect(onCard.y).toBeCloseTo(20 + inset(8), 6);
    const onZone = changedDotCentre(zoneRect);
    expect(onZone.x).toBeCloseTo(300 - inset(10), 6);
    expect(onZone.y).toBeCloseTo(inset(10), 6);
    // A rect smaller than its corner radius: the corner it actually has.
    const tiny = changedDotCentre({ x: 0, y: 0, width: 10, height: 10, role: 'card' });
    expect(tiny.x).toBeCloseTo(10 - inset(5), 6);
  });
});
