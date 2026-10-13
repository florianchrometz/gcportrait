// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The store's "Expand all" and "Collapse all": they work on the diagram on screen (the pipeline's
 * result), write the URL hash as a new history entry (Back undoes them; `history` overrides), and do nothing
 * while nothing is drawn or when they would change nothing. Pressed while the drawing on screen is still another
 * view's (a drill-in or a level just written), they wait for the view's own drawing, and the buttons describe
 * the drawing on screen meanwhile.
 */
import { catalog } from '@gcportrait/catalog';
import { buildSceneWithReport } from '@gcportrait/graph';
import { layoutScene } from '@gcportrait/layout';
import { normalizeViewSpec } from '@gcportrait/model';
import { describe, expect, it, vi } from 'vitest';

import { sceneKey } from '../../state/pipeline';
import { createAppStore, type HashNavigator } from '../../state/store';
import { diagramIcons } from '../iconTable';
import { demoGraphSync } from '../testing/demoScenes';
import { selectCanCollapseAll, selectCanExpandAll, selectExpandLevelName } from './state';

/** Demo M's Shared VPC host (Production). */
const PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000001';

/**
 * A store on demo M's diagram at `hash`, and a function that draws the view in its hash into the pipeline slice (at
 * the 1280 × 800 budget, the canvas unmeasured), as the pipeline does once its workers answer.
 */
function storeWithDraw(hash: string): {
  store: ReturnType<typeof createAppStore>;
  navigate: ReturnType<typeof vi.fn>;
  draw: () => void;
} {
  const store = createAppStore({ location: { pathname: '/diagram', hash: `#${hash}` } });
  const navigate = vi.fn<HashNavigator>();
  store.connectNavigator(navigate);
  const draw = (): void => {
    const spec = store.getState().view.spec;
    const { scene, report } = buildSceneWithReport(demoGraphSync('M'), normalizeViewSpec(spec), catalog, {
      readTime: '2026-10-08T00:00:00Z',
      viewportBudget: 73,
    });
    store.updatePipeline((current) => ({
      ...current,
      key: sceneKey(spec),
      result: {
        key: sceneKey(spec),
        answer: {
          scene,
          report,
          source: { ref: 'demo:M', scope: 'example.com', readTime: '2026-10-08T00:00:00Z', assets: 952 },
          lensTitle: 'Overview',
          icons: diagramIcons(scene),
          zoneTypes: {},
          consoleLinks: {},
        },
        layout: layoutScene(scene),
      },
    }));
  };
  return { store, navigate, draw };
}

/** A store on demo M's diagram whose pipeline draws every view in its hash at once. */
function drawnStore(hash: string): {
  store: ReturnType<typeof createAppStore>;
  navigate: ReturnType<typeof vi.fn>;
} {
  const { store, navigate, draw } = storeWithDraw(hash);
  draw();
  store.subscribe(() => {
    const { view, pipeline } = store.getState();
    if (pipeline.result?.key !== sceneKey(view.spec)) draw();
  });
  return { store, navigate };
}

describe('the store’s Expand all and Collapse all', () => {
  it('opens the next level as a new history entry, then goes back to auto', () => {
    const { store, navigate } = drawnStore('snapshot=demo:M');
    store.actions.expandAll();
    expect(store.getState().view.hash).toBe('snapshot=demo:M&detail=projects');
    expect(navigate).toHaveBeenLastCalledWith(
      { pathname: '/diagram', hash: '#snapshot=demo:M&detail=projects' },
      'push',
    );
    store.actions.expandAll({ history: 'replace' });
    expect(store.getState().view.hash).toBe('snapshot=demo:M&detail=networks');
    expect(navigate).toHaveBeenLastCalledWith(
      { pathname: '/diagram', hash: '#snapshot=demo:M&detail=networks' },
      'replace',
    );
    store.actions.collapseAll();
    expect(store.getState().view.hash).toBe('snapshot=demo:M');
    expect(navigate).toHaveBeenCalledTimes(3);
    // Nothing opened by hand at the automatic level: nothing to collapse.
    store.actions.collapseAll();
    expect(navigate).toHaveBeenCalledTimes(3);
  });

  it('does nothing while nothing is drawn', () => {
    const store = createAppStore({ location: { pathname: '/diagram', hash: '#snapshot=demo:M' } });
    const navigate = vi.fn<HashNavigator>();
    store.connectNavigator(navigate);
    store.actions.expandAll();
    store.actions.collapseAll();
    expect(navigate).not.toHaveBeenCalled();
    expect(store.getState().view.hash).toBe('snapshot=demo:M');
  });
});

describe('pressed while another view is drawn', () => {
  it('Collapse all right after a drill-in waits for the project’s drawing, and is worked out on it', () => {
    // On the organisation at the projects level, Collapse all would go back to Auto (the folder level).
    const { store, navigate, draw } = storeWithDraw('snapshot=demo:M&detail=projects');
    draw();
    expect(selectCanCollapseAll(store.getState())).toBe(true);
    store.actions.drillIn(PROJECT);
    expect(navigate).toHaveBeenCalledTimes(1);
    // The organisation's drawing is still on screen: the buttons describe it, and a press waits.
    expect(selectCanCollapseAll(store.getState())).toBe(true);
    store.actions.collapseAll();
    expect(navigate).toHaveBeenCalledTimes(1);
    // The project's drawing arrives: at the projects level its network is a chip, and Auto would open it (a view
    // of at most 100 rects opens whole), so there is nothing to collapse: nothing is written.
    draw();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(store.getState().view.spec).toMatchObject({ root: PROJECT, detail: 'projects', flips: [] });
    expect(selectCanCollapseAll(store.getState())).toBe(false);
    expect(selectCanExpandAll(store.getState())).toBe(true);
    expect(selectExpandLevelName(store.getState())).toBe('Networks');
  });

  it('Expand all pressed twice opens two levels: the second press waits for the first one’s drawing', () => {
    const { store, navigate, draw } = storeWithDraw('snapshot=demo:M');
    draw();
    store.actions.expandAll();
    store.actions.expandAll();
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(store.getState().view.hash).toBe('snapshot=demo:M&detail=projects');
    draw();
    expect(store.getState().view.hash).toBe('snapshot=demo:M&detail=networks');
    expect(navigate).toHaveBeenCalledTimes(2);
    // Drawn: nothing waits any more.
    draw();
    expect(navigate).toHaveBeenCalledTimes(2);
  });

  it('a press that waits is dropped when the view moves on before its drawing arrives', () => {
    const { store, navigate, draw } = storeWithDraw('snapshot=demo:M');
    draw();
    store.actions.expandAll();
    store.actions.expandAll();
    store.actions.setLens('networking');
    draw();
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(store.getState().view.spec).toMatchObject({ lens: 'networking', detail: 'projects' });
  });
});
