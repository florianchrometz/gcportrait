// SPDX-License-Identifier: Apache-2.0
/**
 * The diagram page (pages/DiagramPage.tsx) in the app with in-process workers, on demo organisation S: its live
 * regions, so that each loading stage and then the drawn diagram's "N of M shown" are announced.
 */
import { waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createInProcessWorkers } from '../diagram/pipeline/inProcess';
import { DIAGRAM_CANVAS_ID } from '../keyboard/SkipToCanvas';
import { drawn } from '../test/diagram';
import { renderApp } from '../test/renderApp';

describe('the diagram page’s live regions', () => {
  it('keeps the loading status in the DOM while idle, so each loading stage is announced', async () => {
    const { container } = renderApp('/diagram#snapshot=demo:S', {
      diagramWorkers: () => createInProcessWorkers(),
    });
    const canvas = container.querySelector<HTMLElement>(`#${DIAGRAM_CANVAS_ID}`);
    if (canvas === null) throw new Error('no canvas area');
    const statuses = (): string[] =>
      within(canvas)
        .queryAllByRole('status')
        .map((status) => status.textContent);
    // Loading: the stage is announced.
    await waitFor(() => {
      expect(statuses().some((text) => text.endsWith('…'))).toBe(true);
    });
    await drawn(container);
    // Drawn: the region stays, empty, and "N of M shown" is a status of its own.
    await waitFor(() => {
      expect(statuses()).toContain('');
      expect(statuses().some((text) => / of [\d,]+ shown$/.test(text))).toBe(true);
    });
  }, 30_000);
});
