// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * Detail `auto` against the measured canvas: the page applies the scene builder's own rule (`autoDetailLevel`, whose
 * cases @gcportrait/graph tests in views/detail.test.ts) to a report's rect counts and ceiling, so it agrees with the
 * builder on demo M, lens ceiling included, and the hysteresis band keeps the level from flapping.
 */
import { catalog } from '@gcportrait/catalog';
import { buildSceneWithReport, viewportBudget } from '@gcportrait/graph';
import { normalizeViewSpec, type LensId, type SceneDetail } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { BREAKPOINTS_REM, CONTAINER } from '../ui/screen';
import { autoLevel, autoLevelChange, budgetOf } from './autoDetail';
import { demoGraphSync } from './testing/demoScenes';

const COUNTS = { folders: 20, projects: 60, networks: 90, all: 300 } as const;

function detail(
  used: SceneDetail['used'],
  requested: SceneDetail['requested'] = 'auto',
  ceiling: SceneDetail['ceiling'] = 'all',
): SceneDetail {
  return { requested, used, budget: 73, ceiling, rectCounts: COUNTS };
}

const ALL = { rectCounts: COUNTS, ceiling: 'all' } as const;

describe('autoLevel', () => {
  it('picks the deepest level that fits, folders when none does, and never collapses 100 rects or fewer', () => {
    expect(autoLevel(ALL, 19)).toBe('folders');
    expect(autoLevel(ALL, 20)).toBe('folders');
    expect(autoLevel(ALL, 73)).toBe('projects');
    expect(autoLevel(ALL, 90)).toBe('networks');
    expect(autoLevel(ALL, 300)).toBe('all');
    expect(
      autoLevel({ rectCounts: { folders: 5, projects: 50, networks: 80, all: 100 }, ceiling: 'all' }, 24),
    ).toBe('all');
  });

  it('never opens deeper than the lens ceiling', () => {
    const networking = { rectCounts: COUNTS, ceiling: 'networks' } as const;
    expect(autoLevel(networking, 300)).toBe('networks');
    expect(autoLevel(networking, 73)).toBe('projects');
    expect(autoLevelChange(detail('networks', 'auto', 'networks'), 400)).toBeNull();
  });

  // The wiring: the report's own counts and ceiling go in. Overview opens to `all`; networking stops at `networks`.
  it.each<LensId>(['overview', 'networking'])(
    'agrees with the scene builder on demo M, %s lens, at every budget',
    (lens) => {
      const graph = demoGraphSync('M');
      const spec = normalizeViewSpec({ snapshot: 'demo:M', lens });
      for (const budget of [24, 40, 57, 73, 100, 148, 200, 250]) {
        const { report } = buildSceneWithReport(graph, spec, catalog, {
          readTime: '2026-10-08T00:00:00Z',
          viewportBudget: budget,
        });
        expect(autoLevel(report.detail, budget), `budget ${String(budget)}`).toBe(report.detail.used);
      }
    },
    30_000,
  );
});

describe('autoLevelChange (hysteresis)', () => {
  it('opens the next level only once the budget clears its rect count by 10 %', () => {
    // At `projects`: networks needs 90 rects, so 90 / 0.9 = 100.
    expect(autoLevelChange(detail('projects'), 95)).toBeNull();
    expect(autoLevelChange(detail('projects'), 99)).toBeNull();
    expect(autoLevelChange(detail('projects'), 100)).toBe('networks');
    expect(autoLevelChange(detail('projects'), 400)).toBe('all');
  });

  it('closes the level only once the budget falls 10 % below its rect count', () => {
    // At `projects` (60 rects): 60 / 1.1 = 54.5.
    expect(autoLevelChange(detail('projects'), 59)).toBeNull();
    expect(autoLevelChange(detail('projects'), 55)).toBeNull();
    expect(autoLevelChange(detail('projects'), 54)).toBe('folders');
  });

  it('does not flap while a window edge is dragged back and forth across a threshold', () => {
    // Opened at 100 (90 rects / 0.9); dragged back down to 82 it stays open, below 90 / 1.1 = 81.8 it closes.
    for (const budget of [99, 95, 90, 85, 82]) expect(autoLevelChange(detail('networks'), budget)).toBeNull();
    expect(autoLevelChange(detail('networks'), 81)).toBe('projects');
    // Closed again, a `projects` view stays anywhere from 55 to 99.
    for (const budget of [55, 60, 75, 90, 99]) expect(autoLevelChange(detail('projects'), budget)).toBeNull();
  });

  it('never changes a level that is not auto, nor at the budget the view was drawn at', () => {
    expect(autoLevelChange(detail('projects', 'projects'), 250)).toBeNull();
    for (const budget of [24, 57, 73, 100, 148, 250]) {
      expect(autoLevelChange(detail(autoLevel(ALL, budget)), budget)).toBeNull();
    }
  });

  it('uses the scene builder budget for a canvas size', () => {
    expect(budgetOf({ width: 1280, height: 624 })).toBe(viewportBudget(1280, 624));
    expect(budgetOf({ width: 1280, height: 624 })).toBe(57);
    expect(budgetOf({ width: 1280, height: 800 })).toBe(73);
  });

  it('gives a phone’s canvas in a workspace too short for the whole timeline bar the smallest budget, so the bar’s fold never changes the level', () => {
    // The widest phone and the tallest workspace `CONTAINER.shortWorkspace` takes, at the default 16-pixel rem: the
    // canvas is at most that big whatever the timeline bar under it folds to (pages/diagram/TimelineBar.module.css).
    const rem = 16;
    const tallest = Number(/max-height: ([\d.]+)rem/.exec(CONTAINER.shortWorkspace)?.[1]) * rem;
    const widest = BREAKPOINTS_REM.tablet * rem;
    expect(Number.isFinite(tallest)).toBe(true);
    expect(budgetOf({ width: widest, height: tallest })).toBe(budgetOf({ width: 0, height: 0 }));
    expect(budgetOf({ width: 0, height: 0 })).toBe(24);
  });
});
