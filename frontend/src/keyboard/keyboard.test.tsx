// SPDX-License-Identifier: Apache-2.0
/**
 * The app's keyboard shortcuts and the skip link to the diagram (style skill §13), in the app with in-process
 * workers: `[` and `]` call the store's timeline action, and when it cannot move (here: no workers, so the
 * snapshot's timeline is never known) say why in a status message (once per press, never while typing or inside a
 * popup), on any keyboard layout (Option or AltGr may be needed to type them; every modifier case in
 * shortcuts.test.ts); the moves themselves are tested with the timeline (timeline/TimelineBar.test.tsx); "Skip to the
 * diagram" shows on the diagram page only and moves focus to the drawing's tab stop, or to the canvas while nothing
 * is drawn, without touching the hash.
 */
import { fireEvent, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { createInProcessWorkers } from '../diagram/pipeline/inProcess';
import { expectNoAxeViolations } from '../test/axe';
import { drawn } from '../test/diagram';
import { currentLocation, renderApp } from '../test/renderApp';
import { DIAGRAM_CANVAS_ID } from './SkipToCanvas';

/** What the keys say while the snapshot's timeline is not known (timeline/model.ts `stepTarget`). */
const TIMELINE_UNAVAILABLE = 'The timeline is not ready yet.';

function timelineStatus(): HTMLElement {
  return screen.getByTestId('timeline-keys-status');
}

describe('the timeline keys', () => {
  it('say once per press why the timeline cannot move, and change nothing', () => {
    const { container } = renderApp('/diagram#snapshot=demo:S&tick=2026-10-01');
    const before = currentLocation(container);
    expect(timelineStatus().getAttribute('role')).toBe('status');
    expect(timelineStatus().textContent).toBe('');
    fireEvent.keyDown(document.body, { key: '[' });
    const first = timelineStatus().firstElementChild;
    expect(timelineStatus().textContent).toBe(TIMELINE_UNAVAILABLE);
    fireEvent.keyDown(document.body, { key: ']' });
    const second = timelineStatus().firstElementChild;
    // The same words, in a new element each time (a keyed remount), so a screen reader announces them again.
    expect(timelineStatus().textContent).toBe(TIMELINE_UNAVAILABLE);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(first?.isConnected).toBe(false);
    expect(currentLocation(container)).toBe(before);
  });

  // The modifier, typing and popup rules on their own, every case: shortcuts.test.ts.
  it('take [ as typed with Option, and leave typing and Cmd shortcuts alone', () => {
    renderApp('/diagram#snapshot=demo:S');
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search assets' }), { key: '[' });
    // Cmd+[ is the browser's Back.
    fireEvent.keyDown(document.body, { key: '[', metaKey: true });
    expect(timelineStatus().textContent).toBe('');
    // A German Mac: Option+5 types `[`.
    fireEvent.keyDown(document.body, { key: '[', altKey: true });
    expect(timelineStatus().textContent).toBe(TIMELINE_UNAVAILABLE);
  });

  it('are the diagram page’s only', () => {
    renderApp('/settings');
    expect(screen.queryByTestId('timeline-keys-status')).toBeNull();
  });
});

describe('the skip link to the diagram', () => {
  it('shows on the diagram page only, after "Skip to content"', () => {
    const settings = renderApp('/settings');
    expect(screen.queryByRole('link', { name: 'Skip to the diagram' })).toBeNull();
    settings.unmount();
    renderApp('/diagram');
    const links = screen.getAllByRole('link', { name: /^Skip to / });
    expect(links.map((link) => link.textContent)).toEqual(['Skip to content', 'Skip to the diagram']);
  });

  it('focuses the canvas while nothing is drawn, keeping the hash', async () => {
    const { container } = renderApp('/diagram');
    await userEvent.click(screen.getByRole('link', { name: 'Skip to the diagram' }));
    expect(document.activeElement?.id).toBe(DIAGRAM_CANVAS_ID);
    expect(currentLocation(container)).toBe('/diagram');
  });

  it('focuses the drawing’s tab stop once a diagram is drawn', async () => {
    const { container } = renderApp('/diagram#snapshot=demo:S', {
      diagramWorkers: () => createInProcessWorkers(),
    });
    const svg = await drawn(container);
    const stop = svg.querySelector('[tabindex="0"]');
    expect(stop).not.toBeNull();
    await userEvent.click(within(document.body).getByRole('link', { name: 'Skip to the diagram' }));
    expect(document.activeElement).toBe(stop);
    expect(currentLocation(container)).toBe('/diagram#snapshot=demo:S');
    await expectNoAxeViolations(container);
  }, 30_000);
});
