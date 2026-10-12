// SPDX-License-Identifier: MIT
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DiagramDrawing, planDrawing, type DrawingOptions } from './Drawing';
import type { DiagramModel } from './model';
import { createPainter, isConsoleAction, nodeIdOf } from './painter';
import { CONSOLE_LINKS as links, modelOf, smallScene, TRACE_EDGES, withConsoleLinks } from './testing/scenes';
import { PATH_CASING, PATH_WIDTH, RING_GAP, SELECT_WIDTH } from './theme/styles';
import { PALETTES } from './theme/tokens';

const OPTIONS: DrawingOptions = { theme: 'light', overlays: true, interactive: true, utcOffsetMinutes: 0 };

function mount(model: DiagramModel): SVGSVGElement {
  const { container } = render(
    <svg>
      <DiagramDrawing model={model} options={OPTIONS} plan={planDrawing(model, OPTIONS)} />
    </svg>,
  );
  const svg = container.querySelector('svg');
  if (svg === null) throw new Error('no svg');
  return svg;
}

const byId = (svg: Element, id: string): Element => svg.querySelector(`[data-id="${id}"]`) as Element;
const focused = (svg: Element): string[] =>
  [...svg.querySelectorAll('.dg-edge-top.is-focus')].map(
    (element) => element.getAttribute('data-edge') ?? '',
  );

describe('the highlight painter (skill §6)', () => {
  const model = modelOf(
    smallScene([
      ['run/web', 'run/api', 'uses'],
      ['run/jobs', 'pools/default', 'routes'],
      ['run/web', 'projects/data', 'triggers'],
    ]),
  );

  it('hover paints the ancestor chain and focuses the edges touching the node or its subtree', () => {
    const svg = mount(model);
    const painter = createPainter(svg, model);
    painter.hover('run/api');
    const chain = ['run/api', 'subnets/a', 'networks/vpc', 'projects/web', 'folders/1'];
    for (const id of chain) expect(byId(svg, id).classList.contains('is-path'), id).toBe(true);
    expect(byId(svg, 'clusters/gke').classList.contains('is-path')).toBe(false);
    expect(focused(svg)).toEqual(['run/web -uses-> run/api']);

    painter.hover('projects/web');
    expect(byId(svg, 'run/api').classList.contains('is-path')).toBe(false);
    expect(byId(svg, 'projects/web').classList.contains('is-path')).toBe(true);
    expect(focused(svg)).toHaveLength(3);

    painter.hover(null);
    expect(svg.querySelectorAll('.is-path')).toHaveLength(0);
    expect(focused(svg)).toEqual([]);
  });

  it('hover draws one path ring on the border of each node of the chain, on its casing band', () => {
    const svg = mount(model);
    const painter = createPainter(svg, model);
    const rings = [...svg.querySelectorAll('.dg-path-ring')];
    // As many rings as the deepest chain needs: a card in a subnet, VPC, project and folder.
    expect(rings).toHaveLength(model.deepestChain);
    expect(model.deepestChain).toBe(5);
    expect(rings.every((ring) => ring.getAttribute('display') === 'none')).toBe(true);
    const casing = rings[0]?.querySelector('.dg-path-casing');
    const line = rings[0]?.querySelector('.dg-path-line');
    expect([casing?.getAttribute('stroke'), casing?.getAttribute('stroke-width')]).toEqual([
      PALETTES.light.pathCasing,
      String(PATH_WIDTH + 2 * PATH_CASING),
    ]);
    expect([line?.getAttribute('stroke'), line?.getAttribute('stroke-width')]).toEqual([
      PALETTES.light.accentPath,
      String(PATH_WIDTH),
    ]);

    painter.hover('subnets/a');
    const chain = ['subnets/a', 'networks/vpc', 'projects/web', 'folders/1'];
    chain.forEach((id, index) => {
      const rect = model.input.layout.rects[id];
      const ring = rings[index];
      expect(ring?.getAttribute('display'), id).toBeNull();
      for (const element of [...(ring?.children ?? [])]) {
        expect(element.getAttribute('x'), id).toBe(String(rect?.x));
        expect(element.getAttribute('width'), id).toBe(String(rect?.width));
        expect(element.getAttribute('rx'), id).toBe('10');
      }
    });
    expect(rings[4]?.getAttribute('display')).toBe('none');

    painter.hover('run/api');
    expect(rings[0]?.querySelector('rect')?.getAttribute('rx')).toBe('8');
    expect(rings.filter((ring) => ring.getAttribute('display') === null)).toHaveLength(5);
    painter.hover(null);
    expect(rings.every((ring) => ring.getAttribute('display') === 'none')).toBe(true);
  });

  it('only mutates classes and attributes, but for the traced lines it puts on top and takes off', () => {
    const svg = mount(model);
    const count = svg.querySelectorAll('*').length;
    const markup = (): string =>
      svg.outerHTML.replace(
        / class="[^"]*"| (x|y|width|height|rx|d|display|tabindex|aria-pressed|aria-label|href|transform)="[^"]*"/g,
        '',
      );
    const before = markup();
    const painter = createPainter(svg, model);
    const added = (): Element[] =>
      [...svg.querySelectorAll('*')].filter((element) => element.closest('.dg-edge-top') !== null);
    painter.hover('run/web');
    painter.select('run/jobs');
    painter.focus('run/api');
    painter.hover('folders/1');
    painter.hover('run/api');
    painter.select('networks/vpc');
    // What is added is the traced lines (a group with its casing and line each) in the layer on top, nothing else.
    const copies = svg.querySelectorAll('.dg-edges-top > .dg-edge-top');
    expect(copies.length).toBeGreaterThan(0);
    expect(svg.querySelectorAll('*').length - count).toBe(added().length);
    expect(added()).toHaveLength(copies.length * 3);
    painter.hover(null);
    painter.select(null);
    painter.focus(null);
    expect(svg.querySelectorAll('*')).toHaveLength(count);
    expect(markup()).toBe(before);
  });

  it('makes each traced line from its kind’s prototype, in drawing order, and takes it off again', () => {
    const svg = mount(model);
    const painter = createPainter(svg, model);
    painter.select('run/jobs');
    const copies = [...svg.querySelectorAll('.dg-edges-top > .dg-edge-top')];
    const order = model.lines.map((edge) => edge.key);
    const keys = copies.map((copy) => copy.getAttribute('data-edge') ?? '');
    expect(keys).toEqual([...keys].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
    for (const copy of copies) {
      const key = copy.getAttribute('data-edge') ?? '';
      const edge = model.lines.find((line) => line.key === key);
      expect(edge).toBeDefined();
      expect(copy.classList.contains('is-focus')).toBe(true);
      expect(copy.getAttribute('display')).toBeNull();
      const [casing, line] = [...copy.children];
      expect(casing?.getAttribute('d')).toBeTruthy();
      expect(line?.getAttribute('d')).toBe(casing?.getAttribute('d'));
    }
    painter.select(null);
    expect(svg.querySelectorAll('.dg-edge-top')).toHaveLength(0);
  });

  it('select draws the accent.select ring with a canvas gap around the node and restarts the pulse', () => {
    const svg = mount(model);
    const painter = createPainter(svg, model);
    painter.select('run/api');
    const ring = svg.querySelector('.dg-select-ring');
    expect(ring?.getAttribute('display')).toBeNull();
    expect(ring?.classList.contains('is-pulsing')).toBe(true);
    const rect = model.input.layout.rects['run/api'];
    const distance = RING_GAP + SELECT_WIDTH / 2;
    const accent = ring?.querySelector('.dg-ring');
    expect(Number(accent?.getAttribute('x'))).toBe((rect?.x ?? 0) - distance);
    expect(Number(accent?.getAttribute('width'))).toBe((rect?.width ?? 0) + 2 * distance);
    expect(accent?.getAttribute('stroke-width')).toBe(String(SELECT_WIDTH));
    expect(byId(svg, 'run/api').getAttribute('aria-pressed')).toBe('true');
    expect(byId(svg, 'run/api').getAttribute('tabindex')).toBe('0');
    expect(focused(svg)).toEqual(['run/web -uses-> run/api']);

    painter.select(null);
    expect(ring?.getAttribute('display')).toBe('none');
    expect(byId(svg, 'run/api').getAttribute('aria-pressed')).toBe('false');
    expect(painter.selected).toBeNull();
  });

  it('keeps one tab stop, the first solid node until another is selected or focused', () => {
    const svg = mount(model);
    const painter = createPainter(svg, model);
    const stops = () =>
      [...svg.querySelectorAll('[tabindex="0"]')].map((element) => element.getAttribute('data-id'));
    expect(stops()).toHaveLength(1);
    painter.setTabStop('run/web');
    expect(stops()).toEqual(['run/web']);
    painter.setTabStop('projects/web'); // an open zone is no tab stop
    expect(stops()).toEqual(['run/web']);
  });

  it('draws the focus ring for keyboard focus and hides it again', () => {
    const svg = mount(model);
    const painter = createPainter(svg, model);
    painter.focus('run/web');
    expect(svg.querySelector('.dg-focus-ring')?.getAttribute('display')).toBeNull();
    painter.focus(null);
    expect(svg.querySelector('.dg-focus-ring')?.getAttribute('display')).toBe('none');
  });

  it('takes every mark off when disposed, and a new painter clears what an old one left', () => {
    const svg = mount(model);
    const clean = svg.outerHTML;
    const first = createPainter(svg, model);
    const paintEverything = (painter: ReturnType<typeof createPainter>): void => {
      painter.hover('run/api');
      painter.select('run/web');
      painter.focus('run/web');
      painter.setTabStop('run/jobs');
    };
    paintEverything(first);
    expect(svg.querySelectorAll('.is-path').length).toBeGreaterThan(0);
    first.dispose();
    expect(svg.querySelectorAll('.is-path, .is-selected, .is-focus, .is-pulsing')).toHaveLength(0);
    expect(svg.querySelectorAll('[tabindex="0"], [aria-pressed="true"]')).toHaveLength(0);
    expect(
      [...svg.querySelectorAll('.dg-path-ring, .dg-select-ring, .dg-focus-ring')].every(
        (ring) => ring.getAttribute('display') === 'none',
      ),
    ).toBe(true);

    // A painter that was never disposed (its marks still on the drawing): the next one starts clean.
    const second = createPainter(svg, model);
    paintEverything(second);
    const third = createPainter(svg, model);
    expect(svg.querySelectorAll('.is-path, .is-selected, .is-focus, .is-pulsing')).toHaveLength(0);
    expect(
      [...svg.querySelectorAll('[tabindex="0"]')].map((element) => element.getAttribute('data-id')),
    ).toEqual([svg.querySelector('.dg-node')?.getAttribute('data-id')]);
    expect(third.hovered).toBeNull();
    third.dispose();
    // Back to the markup React drew (ring geometry aside, which only a shown ring uses).
    const strip = (markup: string): string => markup.replace(/ (x|y|width|height|rx)="[^"]*"/g, '');
    expect(strip(svg.outerHTML)).toBe(strip(clean));
  });

  it('finds the node an event target belongs to', () => {
    const svg = mount(model);
    const text = byId(svg, 'run/api').querySelector('text');
    expect(nodeIdOf(text)).toBe('run/api');
    expect(nodeIdOf(svg)).toBeNull();
    expect(nodeIdOf(null)).toBeNull();
  });
});

describe('the selection trace (skill §6)', () => {
  const model = withConsoleLinks(modelOf(smallScene(TRACE_EDGES)));
  const shown = (svg: Element, selector: string): string[] =>
    [...svg.querySelectorAll(selector)].map(
      (element) => element.getAttribute('data-id') ?? element.getAttribute('data-edge') ?? '',
    );

  it('keeps the selection’s path to the root, its traced lines and the reached nodes until it changes', () => {
    const svg = mount(model);
    const painter = createPainter(svg, model);
    painter.select('run/api');
    expect(painter.traced).toBe('run/api');
    // The zones around it, not the node itself (it has the selection ring).
    expect(shown(svg, '.is-path')).toEqual(['folders/1', 'projects/web', 'networks/vpc', 'subnets/a']);
    expect(shown(svg, '.dg-edge-top.is-focus').sort()).toEqual([
      'run/api -routes-> pools/default',
      'run/web -routes-> run/api',
    ]);
    expect(shown(svg, '.is-reached').sort()).toEqual(['pools/default', 'run/web']);
    const reach = svg.querySelector('.dg-reach-rings');
    expect(reach?.getAttribute('display')).toBeNull();
    expect((reach?.querySelector('.dg-ring')?.getAttribute('d') ?? '').match(/M/g)).toHaveLength(2);
    const rings = [...svg.querySelectorAll('.dg-path-ring')].filter(
      (ring) => ring.getAttribute('display') === null,
    );
    expect(rings).toHaveLength(4);
    expect(rings[0]?.querySelector('.dg-path-line')?.getAttribute('stroke-width')).toBe('3');
    // The legend's trace column is shown and the panel widened to it.
    const panel = svg.querySelector('.dg-legend-panel');
    expect(svg.querySelector('.dg-legend-trace')?.getAttribute('display')).toBeNull();
    expect(panel?.getAttribute('width')).toBe(panel?.getAttribute('data-trace-width'));

    painter.select(null);
    expect(svg.querySelectorAll('.is-path, .is-reached, .dg-edge-top.is-focus')).toHaveLength(0);
    expect(reach?.getAttribute('display')).toBe('none');
    expect(svg.querySelector('.dg-legend-trace')?.getAttribute('display')).toBe('none');
    expect(panel?.getAttribute('width')).toBe(panel?.getAttribute('data-width'));
  });

  it('previews a hovered card’s trace without touching the selection, and returns to the selection’s', () => {
    const svg = mount(model);
    const painter = createPainter(svg, model);
    painter.select('run/api');
    painter.hover('run/jobs');
    expect(painter.selected).toBe('run/api');
    expect(painter.traced).toBe('run/jobs');
    // A preview's path starts at the hovered node itself.
    expect(shown(svg, '.is-path')).toEqual(['folders/1', 'projects/web', 'run/jobs']);
    expect(shown(svg, '.dg-edge-top.is-focus')).toEqual(['run/jobs -uses-> projects/data']);
    expect(svg.querySelector('.dg-select-ring')?.getAttribute('display')).toBeNull();
    // An open zone under the pointer does not hide the selection's trace.
    painter.hover('projects/web');
    expect(painter.traced).toBe('run/api');
    painter.hover(null);
    expect(painter.traced).toBe('run/api');
    expect(shown(svg, '.is-reached').sort()).toEqual(['pools/default', 'run/web']);
    // Without a selection an open zone previews too.
    painter.select(null);
    painter.hover('projects/web');
    expect(painter.traced).toBe('projects/web');
  });

  it('places the console action inside the selected node’s top-right corner, named, a tab stop, never for a node without a link', () => {
    const svg = mount(model);
    const painter = createPainter(svg, model);
    const group = svg.querySelector('.dg-actions');
    const link = svg.querySelector('.dg-console-action');
    expect(group?.getAttribute('display')).toBe('none');
    expect(link?.getAttribute('href')).toBeNull();
    // Out of the tab order while hidden, a tab stop after the node once shown.
    expect(link?.getAttribute('tabindex')).toBe('-1');
    painter.select('run/api');
    expect(link?.getAttribute('tabindex')).toBe('0');
    expect(group?.getAttribute('display')).toBeNull();
    expect(link?.getAttribute('href')).toBe(links['run/api'].url);
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.getAttribute('aria-label')).toBe('Open orders-api in Cloud Console (opens a new tab)');
    const resource = link?.querySelector('.dg-console-resource');
    expect(resource?.getAttribute('display')).toBeNull();
    expect(resource?.querySelector('title')?.textContent).toBe('Open in Cloud Console ↗ (opens a new tab)');
    // Anchored at the card's top-right corner; both pills are drawn leftwards from there, inside the card.
    const rect = model.input.layout.rects['run/api'];
    if (rect === undefined) throw new Error('no rect for run/api');
    expect(link?.getAttribute('transform')).toBe(
      `translate(${String(rect.x + rect.width)} ${String(rect.y)})`,
    );
    const compact = resource?.querySelector('.dg-console-compact .dg-console-pill');
    expect(compact?.getAttribute('x')).toBe('-16');
    expect(compact?.getAttribute('height')).toBe('16');
    const width = Number(resource?.getAttribute('data-width'));
    expect(resource?.querySelector('.dg-console-full')?.getAttribute('display')).toBe('none');
    expect(resource?.querySelector('.dg-console-full .dg-console-pill')?.getAttribute('x')).toBe(
      String(-width),
    );
    // The labelled pill shows on hover and focus only where it fits inside the card.
    expect(link?.getAttribute('data-expand')).toBe(width <= rect.width ? 'true' : 'false');
    // No template: the project's console home, with its own text.
    painter.select('run/web');
    expect(link?.getAttribute('href')).toBe(links['run/web'].url);
    expect(link?.getAttribute('aria-label')).toBe(
      'Open project demo-web-1 in Cloud Console (opens a new tab)',
    );
    expect(link?.querySelector('.dg-console-project')?.getAttribute('display')).toBeNull();
    expect(link?.querySelector('.dg-console-resource')?.getAttribute('display')).toBe('none');
    // An open zone keeps the icon-only pill, concentric with its 10 px corner.
    painter.select('projects/web');
    const zone = model.input.layout.rects['projects/web'];
    if (zone === undefined) throw new Error('no rect for projects/web');
    expect(link?.getAttribute('transform')).toBe(
      `translate(${String(zone.x + zone.width - 2)} ${String(zone.y + 2)})`,
    );
    expect(link?.getAttribute('data-expand')).toBe('false');
    // A node without a link: no action.
    painter.select('run/jobs');
    expect(group?.getAttribute('display')).toBe('none');
    expect(link?.getAttribute('href')).toBeNull();
    expect(link?.getAttribute('data-expand')).toBeNull();
    expect(link?.getAttribute('tabindex')).toBe('-1');
    expect(isConsoleAction(link?.querySelector('text') ?? null)).toBe(true);
    expect(isConsoleAction(svg)).toBe(false);
  });

  it('paints the same trace again for a new painter of the same drawing: ids, not elements, carry it', () => {
    const svg = mount(model);
    const first = createPainter(svg, model);
    first.select('run/api');
    const painted = (): string[] => [
      ...shown(svg, '.is-path'),
      ...shown(svg, '.is-reached'),
      ...shown(svg, '.dg-edge-top.is-focus'),
    ];
    const before = painted();
    // A theme or settings change keeps the elements and replaces the painter; the page selects again by id.
    const second = createPainter(svg, model);
    expect(painted()).toEqual([]);
    second.select('run/api');
    expect(painted()).toEqual(before);
    // A new layout of the same view draws new elements; the same id finds them.
    const fresh = mount(model);
    createPainter(fresh, model).select('run/api');
    expect([
      ...shown(fresh, '.is-path'),
      ...shown(fresh, '.is-reached'),
      ...shown(fresh, '.dg-edge-top.is-focus'),
    ]).toEqual(before);
  });

  it('maps a click on a secures overlay to its target', () => {
    const secured = modelOf(smallScene([['clusters/gke', 'networks/vpc', 'secures']]));
    const svg = mount(secured);
    expect(nodeIdOf(svg.querySelector('.dg-overlay-line'))).toBe('networks/vpc');
  });
});
