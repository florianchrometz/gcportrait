// SPDX-License-Identifier: Apache-2.0
/**
 * Progressive disclosure on the interactive canvas: a click on a chip, or Enter or Space on a
 * focused one, flips it open instead of selecting it; every open zone has a named collapse button over its
 * header icon that flips it closed; the drawing with the flip keeps the camera (no fit) and glides to the zone;
 * after a flip from the keyboard focus follows the zone, which stays the drawing's one tab stop; a canvas
 * without `onFlip` behaves as before.
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

import { expectNoAxeViolations } from '../../test/axe';
import { DiagramCanvas, type DiagramCanvasProps } from '../DiagramCanvas';
import {
  cameraOf,
  canvasOf as canvas,
  canvasProps,
  chipOf,
  collapseOf,
  element,
  manualFrames,
  reduceMotion,
  tabStops,
} from '../testing/canvas';
import { card, modelOf, scene, smallScene, zone } from '../testing/scenes';
import { fitTransform } from '../viewport';
import { flipTransform } from './flipCamera';

/** The small scene with its collapsed project ('projects/data') as a chip, and with it open. */
const collapsed = modelOf(smallScene([['run/web', 'run/api', 'uses']]));
const expanded = modelOf(
  scene([
    zone('folders/1', 'folder', 'Platform', [
      zone('projects/web', 'project', 'Retail web', [
        card('run/api', 'orders-api'),
        card('run/web', 'storefront'),
      ]),
      zone('projects/data', 'project', 'Analytics', [
        zone('networks/data', 'vpc', 'vpc-data', [], { collapsed: { subnets: 2, resources: 12 } }),
        card('bq/events', 'events'),
        card('bq/orders', 'orders'),
      ]),
    ]),
  ]),
);

/** The canvas on the small scene with its chip, flips handled. */
const props = (overrides: Partial<DiagramCanvasProps> = {}): DiagramCanvasProps =>
  canvasProps(collapsed, { onFlip: () => undefined, ...overrides });

describe('chips', () => {
  it('a click expands a chip (its flip) instead of selecting it; a double-click flips once', () => {
    const onFlip = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(<DiagramCanvas {...props({ onFlip, onSelect })} />);
    const chip = chipOf(canvas(container), 'projects/data');
    fireEvent.click(chip.querySelector('text') ?? chip);
    expect(onFlip.mock.calls).toEqual([['projects/data']]);
    fireEvent.click(chip, { detail: 2 });
    expect(onFlip).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    // A card is still selected by a click.
    fireEvent.click(element(canvas(container), '[data-id="run/api"]'));
    expect(onSelect).toHaveBeenLastCalledWith('run/api');
  });

  it('a double-click on a chip drills in and leaves no flip: its first click’s flip is undone in place', () => {
    const onFlip = vi.fn();
    const onDrillIn = vi.fn();
    const { container } = render(<DiagramCanvas {...props({ onFlip, onDrillIn })} />);
    const chip = chipOf(canvas(container), 'projects/data');
    fireEvent.click(chip, { detail: 1 });
    fireEvent.click(chip, { detail: 2 });
    fireEvent.dblClick(chip);
    expect(onFlip.mock.calls).toEqual([['projects/data'], ['projects/data', { history: 'replace' }]]);
    expect(onDrillIn.mock.calls).toEqual([['projects/data', { history: 'replace' }]]);
    // A double-click on an open zone's body flipped nothing: a plain drill-in.
    const folder = element(canvas(container), '.dg-zone[data-id="folders/1"]');
    fireEvent.click(folder, { detail: 1 });
    fireEvent.click(folder, { detail: 2 });
    fireEvent.dblClick(folder);
    expect(onFlip).toHaveBeenCalledTimes(2);
    expect(onDrillIn).toHaveBeenLastCalledWith('folders/1');
  });

  it('Enter or Space on a focused chip expands it; a held key flips once', () => {
    const onFlip = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(<DiagramCanvas {...props({ onFlip, onSelect })} />);
    const chip = chipOf(canvas(container), 'projects/data');
    chip.focus();
    fireEvent.keyDown(chip, { key: 'Enter' });
    fireEvent.keyDown(chip, { key: ' ' });
    fireEvent.keyDown(chip, { key: ' ', repeat: true });
    expect(onFlip.mock.calls).toEqual([['projects/data'], ['projects/data']]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('without onFlip a chip is selected like any node and no zone has a collapse button', () => {
    const onSelect = vi.fn();
    const without: { -readonly [K in keyof DiagramCanvasProps]: DiagramCanvasProps[K] } = props({ onSelect });
    delete without.onFlip;
    const { container } = render(<DiagramCanvas {...without} />);
    const svg = canvas(container);
    expect(svg.querySelectorAll('.dg-collapse')).toHaveLength(0);
    fireEvent.click(chipOf(svg, 'projects/data'));
    expect(onSelect).toHaveBeenLastCalledWith('projects/data');
  });
});

describe('bundles', () => {
  it('show their member count as a badge in the header, and collapse like any open zone', () => {
    const bundled = modelOf(
      scene([
        zone(
          'group:projects/a',
          'group',
          'a – c',
          [zone('projects/a', 'project', 'a', [card('run/a', 'a')]), card('run/b', 'b'), card('run/c', 'c')],
          { badges: ['3 items'] },
        ),
      ]),
    );
    const onFlip = vi.fn();
    const { container } = render(<DiagramCanvas {...props({ model: bundled, onFlip })} />);
    const svg = canvas(container);
    const group = element(svg, '.dg-zone[data-id="group:projects/a"]');
    expect(group.textContent).toContain('3 items');
    const button = collapseOf(svg, 'group:projects/a');
    expect(button.getAttribute('aria-label')).toBe('Collapse Group: a – c');
    fireEvent.click(button);
    expect(onFlip).toHaveBeenCalledWith('group:projects/a');
  });
});

describe('the collapse button of an open zone', () => {
  it('is drawn on every open zone, named after it, over its header icon, and is no tab stop of its own', async () => {
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const open = [...svg.querySelectorAll('.dg-zone')].map((group) => group.getAttribute('data-id'));
    const buttons = [...svg.querySelectorAll('.dg-collapse')];
    expect(buttons.map((button) => button.getAttribute('data-collapse'))).toEqual(open);
    const web = collapseOf(svg, 'projects/web');
    expect(web.getAttribute('role')).toBe('button');
    expect(web.getAttribute('aria-label')).toBe('Collapse Project: Retail web (demo-web-1)');
    expect(web.getAttribute('tabindex')).toBe('-1');
    expect(web.parentElement?.getAttribute('data-id')).toBe('projects/web');
    // One tab stop in the drawing, as before: the first solid node.
    expect(tabStops(svg)).toHaveLength(1);
    await expectNoAxeViolations(container);
  });

  it('a click or Enter collapses the zone (its flip) and selects nothing', () => {
    const onFlip = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(<DiagramCanvas {...props({ onFlip, onSelect })} />);
    const button = collapseOf(canvas(container), 'networks/vpc');
    fireEvent.click(button.querySelector('rect') ?? button);
    button.focus();
    fireEvent.keyDown(button, { key: 'Enter' });
    expect(onFlip.mock.calls).toEqual([['networks/vpc'], ['networks/vpc']]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('holds the drawing’s tab stop when focused, with no ring around its zone', () => {
    const { container } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const button = collapseOf(svg, 'projects/web');
    button.focus();
    expect(tabStops(svg)).toEqual([button]);
    expect(element(svg, '.dg-focus-ring').getAttribute('display')).toBe('none');
  });
});

describe('the camera and focus after a flip', () => {
  it('keeps the camera for the drawing with the flip and glides to frame the zone', () => {
    reduceMotion();
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const before = cameraOf(svg);
    fireEvent.click(chipOf(svg, 'projects/data'));
    rerender(<DiagramCanvas {...props({ model: expanded })} />);
    const rect = expanded.input.layout.rects['projects/data'];
    if (rect === undefined) throw new Error('no rect');
    const expected = flipTransform(rect, 1280, 800, before, true);
    const now = cameraOf(svg);
    expect(now.k).toBeCloseTo(expected.k);
    expect(now.x).toBeCloseTo(expected.x);
    expect(now.y).toBeCloseTo(expected.y);
  });

  it('frames the zone in the part of the canvas an open drawer leaves (a tablet’s, over its right half)', () => {
    reduceMotion();
    const drawer = document.createElement('div');
    drawer.setAttribute('data-canvas-overlay', '');
    drawer.getBoundingClientRect = () => DOMRect.fromRect({ x: 640, y: 0, width: 640, height: 800 });
    document.body.append(drawer);
    onTestFinished(() => {
      drawer.remove();
    });
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    svg.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 1280, height: 800 });
    const before = cameraOf(svg);
    fireEvent.click(chipOf(svg, 'projects/data'));
    rerender(<DiagramCanvas {...props({ model: expanded })} />);
    const rect = expanded.input.layout.rects['projects/data'];
    if (rect === undefined) throw new Error('no rect');
    // The room left of the drawer, 640 × 800 at the canvas's top-left corner: framed there as on a canvas that size.
    const expected = flipTransform(rect, 640, 800, before, true);
    const now = cameraOf(svg);
    expect(now.k).toBeCloseTo(expected.k);
    expect(now.x).toBeCloseTo(expected.x);
    expect(now.y).toBeCloseTo(expected.y);
    expect((rect.x + rect.width / 2) * now.k + now.x).toBeCloseTo(320);
  });

  it('frames the zone clear of the disclosure bar at rest, which only the directed moves keep clear of', () => {
    reduceMotion();
    // The bar floats over the canvas's foot at rest: marked for the moves, not as a panel a fit clears.
    const bar = document.createElement('div');
    bar.setAttribute('data-canvas-jump', '');
    bar.getBoundingClientRect = () => DOMRect.fromRect({ x: 836, y: 734, width: 432, height: 54 });
    document.body.append(bar);
    onTestFinished(() => {
      bar.remove();
    });
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    svg.getBoundingClientRect = () => DOMRect.fromRect({ x: 0, y: 0, width: 1280, height: 800 });
    const before = cameraOf(svg);
    fireEvent.click(chipOf(svg, 'projects/data'));
    rerender(<DiagramCanvas {...props({ model: expanded })} />);
    const rect = expanded.input.layout.rects['projects/data'];
    if (rect === undefined) throw new Error('no rect');
    // The canvas above the bar, 1280 × 734, is the part it leaves: framed there as on a canvas that size.
    const expected = flipTransform(rect, 1280, 734, before, true);
    const now = cameraOf(svg);
    expect(now.k).toBeCloseTo(expected.k);
    expect(now.x).toBeCloseTo(expected.x);
    expect(now.y).toBeCloseTo(expected.y);
    expect((rect.y + rect.height / 2) * now.k + now.y).toBeCloseTo(734 / 2);
  });

  it('keeps the viewBox while the glide has not stepped yet, and fits a drawing nobody flipped', () => {
    const frames = manualFrames();
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const before = cameraOf(svg);
    fireEvent.click(chipOf(svg, 'projects/data'));
    rerender(<DiagramCanvas {...props({ model: expanded })} />);
    expect(cameraOf(svg)).toEqual(before);
    expect(frames.pending()).toBeGreaterThan(0);
    frames.run(performance.now() + 10_000);
    expect(cameraOf(svg)).not.toEqual(before);

    // A new drawing that no flip here asked for (another view) is fitted.
    rerender(<DiagramCanvas {...props({ model: collapsed })} />);
    const frame = svg.querySelector('.dg-background');
    const fit = fitTransform(
      {
        x: Number(frame?.getAttribute('x')),
        y: Number(frame?.getAttribute('y')),
        width: Number(frame?.getAttribute('width')),
        height: Number(frame?.getAttribute('height')),
      },
      1280,
      800,
    );
    expect(cameraOf(svg).k).toBeCloseTo(fit.k);
    expect(cameraOf(svg).x).toBeCloseTo(fit.x);
  });

  it('moves focus from a chip expanded with Enter to its collapse button, and back to the chip', () => {
    reduceMotion();
    const onFlip = vi.fn();
    const { container, rerender } = render(<DiagramCanvas {...props({ onFlip })} />);
    const svg = canvas(container);
    const chip = chipOf(svg, 'projects/data');
    chip.focus();
    fireEvent.keyDown(chip, { key: 'Enter' });
    rerender(<DiagramCanvas {...props({ onFlip, model: expanded })} />);
    const button = collapseOf(svg, 'projects/data');
    expect(document.activeElement).toBe(button);
    expect(tabStops(svg)).toEqual([button]);

    fireEvent.keyDown(button, { key: ' ' });
    expect(onFlip).toHaveBeenLastCalledWith('projects/data');
    rerender(<DiagramCanvas {...props({ onFlip, model: collapsed })} />);
    const again = chipOf(svg, 'projects/data');
    expect(document.activeElement).toBe(again);
    expect(tabStops(svg)).toEqual([again]);
  });

  it('leaves focus alone after a flip made with the pointer', () => {
    reduceMotion();
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    fireEvent.click(chipOf(svg, 'projects/data'));
    rerender(<DiagramCanvas {...props({ model: expanded })} />);
    expect(svg.contains(document.activeElement)).toBe(false);
  });
});
