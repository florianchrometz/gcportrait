// SPDX-License-Identifier: MIT
/**
 * The interactive canvas on its own: it says it is ready (`data-diagram-ready`) only once it can be used, numbers
 * each drawing (`data-drawing`) so that the next one can be told from the last, and a theme change, which re-renders
 * the same elements, leaves no stale highlight behind but keeps the selection and the keyboard focus painted.
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DiagramCanvas, type DiagramCanvasProps } from './DiagramCanvas';
import { canvasOf as canvas, canvasProps, nodeOf as node } from './testing/canvas';
import { modelOf, smallScene, withConsoleLinks } from './testing/scenes';

const model = modelOf(
  smallScene([
    ['run/web', 'run/api', 'uses'],
    ['run/jobs', 'pools/default', 'routes'],
  ]),
);

const props = (overrides: Partial<DiagramCanvasProps> = {}): DiagramCanvasProps =>
  canvasProps(model, overrides);

const shownRings = (svg: Element, selector: string): number =>
  [...svg.querySelectorAll(selector)].filter((ring) => ring.getAttribute('display') === null).length;

describe('DiagramCanvas', () => {
  it('sets data-diagram-ready and data-drawing only once the painter and its listeners are attached', () => {
    // What a test (or the e2e suite) can do the moment it sees either: find the tab stop, hover a node.
    const seen: Array<{ name: string; stops: number; hoverPaints: boolean }> = [];
    // The real method, read off its descriptor: it runs with whatever element the spy is called on.
    const original: unknown = Object.getOwnPropertyDescriptor(Element.prototype, 'setAttribute')?.value;
    if (typeof original !== 'function') throw new Error('no Element.prototype.setAttribute');
    const spy = vi.spyOn(Element.prototype, 'setAttribute').mockImplementation(function (
      this: Element,
      name: string,
      value: string,
    ) {
      if (name === 'data-diagram-ready' || name === 'data-drawing') {
        const card = this.querySelector('[data-id="run/api"]');
        card?.dispatchEvent(new Event('pointerover', { bubbles: true }));
        seen.push({
          name,
          stops: this.querySelectorAll('.dg-node[tabindex="0"]').length,
          hoverPaints: card?.classList.contains('is-path') === true,
        });
        this.dispatchEvent(new Event('pointerleave'));
      }
      Reflect.apply(original, this, [name, value]);
    });
    try {
      const { container } = render(<DiagramCanvas {...props()} />);
      expect(canvas(container).getAttribute('data-diagram-ready')).toBe('true');
    } finally {
      spy.mockRestore();
    }
    expect(seen).toEqual([
      { name: 'data-drawing', stops: 1, hoverPaints: true },
      { name: 'data-diagram-ready', stops: 1, hoverPaints: true },
    ]);
  });

  it('gives every drawing the next number: a new view and a theme change draw again, a selection does not', () => {
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const drawing = (): number => Number(svg.getAttribute('data-drawing'));
    const first = drawing();
    expect(first).toBeGreaterThan(0);
    // A selection only paints the drawing on the canvas.
    rerender(<DiagramCanvas {...props({ selection: 'run/web' })} />);
    expect(drawing()).toBe(first);
    // Another view (a lens, a drill-in, a day): a drawing of its own, and the canvas is ready again at once.
    const other = modelOf(smallScene([['run/web', 'run/api', 'uses']]));
    rerender(<DiagramCanvas {...props({ model: other, selection: 'run/web' })} />);
    const second = drawing();
    expect(second).toBeGreaterThan(first);
    expect(svg.getAttribute('data-diagram-ready')).toBe('true');
    // The same view in the other theme is drawn again too.
    rerender(<DiagramCanvas {...props({ model: other, selection: 'run/web', theme: 'dark' })} />);
    expect(drawing()).toBeGreaterThan(second);
  });

  it('numbers the drawings for the page: a canvas mounted again repeats no number', () => {
    const before = render(<DiagramCanvas {...props()} />);
    const first = Number(canvas(before.container).getAttribute('data-drawing'));
    before.unmount();
    const after = render(<DiagramCanvas {...props()} />);
    expect(Number(canvas(after.container).getAttribute('data-drawing'))).toBeGreaterThan(first);
  });

  it('leaves no hover highlight behind when the theme changes under the pointer', () => {
    const { container, rerender } = render(<DiagramCanvas {...props()} />);
    const svg = canvas(container);
    const api = node(svg, 'run/api');
    fireEvent.pointerOver(api);
    expect(svg.querySelectorAll('.is-path')).toHaveLength(5);
    expect(shownRings(svg, '.dg-path-ring')).toBe(5);
    expect(svg.querySelectorAll('.dg-edge-top.is-focus')).toHaveLength(1);

    rerender(<DiagramCanvas {...props({ theme: 'dark' })} />);
    // React kept the elements (it re-renders the same drawing in the other theme) ...
    expect(node(svg, 'run/api')).toBe(api);
    expect(svg.getAttribute('data-theme')).toBe('dark');
    // ... and the old painter took its marks off them.
    expect(svg.querySelectorAll('.is-path, .dg-edge-top.is-focus')).toHaveLength(0);
    expect(shownRings(svg, '.dg-path-ring')).toBe(0);

    // The new painter paints and clears as usual.
    fireEvent.pointerOver(node(svg, 'run/jobs'));
    expect(svg.querySelectorAll('.is-path')).toHaveLength(3);
    fireEvent.pointerLeave(svg);
    expect(svg.querySelectorAll('.is-path')).toHaveLength(0);
    expect(shownRings(svg, '.dg-path-ring')).toBe(0);
  });

  it('keeps the selection and the keyboard focus painted across a theme change, with one tab stop', () => {
    const { container, rerender } = render(<DiagramCanvas {...props({ selection: 'run/web' })} />);
    const svg = canvas(container);
    const web = node(svg, 'run/web');
    const api = node(svg, 'run/api');
    expect(web.getAttribute('aria-pressed')).toBe('true');
    api.focus();
    expect(document.activeElement).toBe(api);
    expect(shownRings(svg, '.dg-focus-ring')).toBe(1);
    const stops = (): Array<string | null> =>
      [...svg.querySelectorAll('[tabindex="0"]')].map((element) => element.getAttribute('data-id'));
    expect(stops()).toEqual(['run/api']);

    rerender(<DiagramCanvas {...props({ selection: 'run/web', theme: 'dark' })} />);
    expect(document.activeElement).toBe(api);
    expect(web.classList.contains('is-selected')).toBe(true);
    expect(web.getAttribute('aria-pressed')).toBe('true');
    expect(shownRings(svg, '.dg-select-ring')).toBe(1);
    expect(shownRings(svg, '.dg-focus-ring')).toBe(1);
    expect(stops()).toEqual(['run/api']);
  });

  it('makes the selected card’s console action the tab stop after it; Escape there goes back to the card', () => {
    const linked = withConsoleLinks(model);
    const onSelect = vi.fn();
    const { container } = render(
      <DiagramCanvas {...props({ model: linked, selection: 'run/api', onSelect })} />,
    );
    const svg = canvas(container);
    const api = node(svg, 'run/api');
    const action = svg.querySelector<SVGAElement>('.dg-console-action');
    if (action === null) throw new Error('no console action');
    // DOM order is tab order: the roving node, then the action (drawn after every node).
    const stops = [...svg.querySelectorAll('[tabindex="0"]')];
    expect(stops).toEqual([api, action]);
    action.focus();
    expect(document.activeElement).toBe(action);
    fireEvent.keyDown(action, { key: 'Escape' });
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(document.activeElement).toBe(api);
    // A click on the action opens its link (a new tab) and changes nothing in the app.
    onSelect.mockClear();
    fireEvent.click(action);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
