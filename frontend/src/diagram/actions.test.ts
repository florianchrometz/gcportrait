// SPDX-License-Identifier: MIT
import { describe, expect, it, vi } from 'vitest';

import { canDrillIn, consoleActionOf, hasResourceName, nodeMenuItems } from './actions';
import { CONSOLE_LINKS, modelOf, smallScene, withConsoleLinks } from './testing/scenes';

const RESOURCE = CONSOLE_LINKS['run/api'].url;
const PROJECT = CONSOLE_LINKS['run/web'].url;
const base = modelOf(smallScene());
const model = withConsoleLinks(base);

describe('consoleActionOf (the one console action: card, menu, drawer)', () => {
  it('words a resource link and the project fallback for each place', () => {
    expect(consoleActionOf(model, 'run/api')).toEqual({
      kind: 'resource',
      href: RESOURCE,
      label: 'Open in Cloud Console',
      pill: 'Open in Cloud Console ↗',
      name: 'Open orders-api in Cloud Console (opens a new tab)',
    });
    expect(consoleActionOf(model, 'run/web')).toEqual({
      kind: 'project',
      href: PROJECT,
      label: 'Open project in Cloud Console',
      pill: 'Open project in Cloud Console ↗',
      name: 'Open project demo-web-1 in Cloud Console (opens a new tab)',
    });
    expect(consoleActionOf(model, 'run/jobs')).toBeUndefined();
    expect(consoleActionOf(base, 'run/api')).toBeUndefined();
  });
});

describe('nodeMenuItems', () => {
  const both = { copy: () => undefined, drillIn: () => undefined };

  it.each([
    ['a card with a console link', 'run/api', both, ['Open in Cloud Console', 'Copy resource name']],
    ['an open zone', 'projects/web', both, ['Open in Cloud Console', 'Copy resource name', 'Details']],
    // A chip is a container too; without a drill-in handler the menu does not offer it.
    ['a chip, without a drill-in handler', 'projects/data', { copy: both.copy }, ['Copy resource name']],
    ['a node the drawing does not have', 'nowhere', both, []],
  ])('lists the items for %s (%s)', (_what, id, handlers, labels) => {
    expect(nodeMenuItems(model, id, handlers).map((item) => item.label)).toEqual(labels);
  });

  it('links the console page, and copies or drills into the node it is for', () => {
    const copy = vi.fn();
    const drillIn = vi.fn();
    const [open, copyName] = nodeMenuItems(model, 'run/api', { copy, drillIn });
    expect(open?.href).toBe(RESOURCE);
    copyName?.onSelect?.();
    expect(copy).toHaveBeenCalledWith('run/api');
    nodeMenuItems(model, 'projects/web', { copy, drillIn })[2]?.onSelect?.();
    expect(drillIn).toHaveBeenCalledWith('projects/web');
  });

  it('drills into containers only, chips among them, and names only nodes it has', () => {
    expect(canDrillIn(model, 'projects/data')).toBe(true);
    expect(canDrillIn(model, 'run/api')).toBe(false);
    expect(hasResourceName(model, 'nowhere')).toBe(false);
  });
});
