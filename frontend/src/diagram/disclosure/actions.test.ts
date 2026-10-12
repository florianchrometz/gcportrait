// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * The store's "Expand all" and "Collapse all": they work on the diagram on screen (the pipeline's
 * result), write the URL hash as a new history entry (Back undoes them; `history` overrides), and do nothing
 * while nothing is drawn or when they would change nothing.
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

/** A store on demo M's diagram whose pipeline has drawn the view in its hash (at the 1280 × 800 budget). */
function drawnStore(hash: string): {
  store: ReturnType<typeof createAppStore>;
  navigate: ReturnType<typeof vi.fn>;
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
