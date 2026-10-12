// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * Locating a search hit in a view (locate.ts) on the demo organisations with the real catalog and scene
 * builder: drawn as itself, inside chips (the flips open them, and the view with them draws the node), outside
 * the drill-in root or the focus (drill in), not in the lens, hidden by role or by its type's rule, excluded,
 * filtered out, and unknown. Every offer is checked the way the page will draw it.
 */
import { catalog } from '@gcportrait/catalog';
import { generateOrganization, toSnapshot } from '@gcportrait/demo-data';
import { buildGraph, buildSceneWithReport, viewportBudget } from '@gcportrait/graph';
import {
  normalizeViewSpec,
  type Graph,
  type SceneEnv,
  type ViewSpec,
  type ViewSpecInput,
} from '@gcportrait/model';
import { describe, expect, it } from 'vitest';

import { applySteps, drillTarget, lensDefaultsOf, locateNode, type LocateContext } from './locate';
import type { LocateAnswer } from './protocol';

function context(size: 'S' | 'M'): LocateContext {
  const snapshot = toSnapshot(generateOrganization({ size }));
  const env: SceneEnv = {
    readTime: snapshot.readTime,
    rootLabel: 'example.com',
    // The canvas at 1280 × 800 with the top bar, the timeline bar and the footer (about 1280 × 624).
    viewportBudget: viewportBudget(1280, 624),
  };
  return { graph: buildGraph(snapshot, catalog), catalog, env };
}

const S = context('S');
const M = context('M');

function view(size: 'S' | 'M', input: Omit<ViewSpecInput, 'snapshot'> = {}): ViewSpec {
  return normalizeViewSpec({ snapshot: `demo:${size}`, ...input });
}

/** The scene node that shows `id` in `spec` (what the page will draw). */
function shownIn(ctx: LocateContext, spec: ViewSpec, id: string): string | undefined {
  return buildSceneWithReport(ctx.graph, { ...spec, selection: id }, ctx.catalog, ctx.env).report.selection
    ?.shownAs;
}

function offersOf(answer: LocateAnswer): string[][] {
  return answer.kind === 'offer' ? answer.offers.map((offer) => [...offer.steps]) : [];
}

function nodeOf(graph: Graph, id: string) {
  const node = graph.nodes[id];
  if (node === undefined) throw new Error(`no node ${id}`);
  return node;
}

const WEB_VM = '//compute.googleapis.com/projects/demo-web-1/zones/europe-west3-a/instances/web-1mnl';
const ORDERS_API = '//run.googleapis.com/projects/demo-svc-1/locations/europe-west3/services/orders-api';
const WEB_PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000007';
const SVC_PROJECT = '//cloudresourcemanager.googleapis.com/projects/10000000009';
const KMS_KEY =
  '//cloudkms.googleapis.com/projects/demo-sec-1/locations/europe-west3/keyRings/kr-europe-west3/cryptoKeys/cmek-shared';
const KMS_KEY_M =
  '//cloudkms.googleapis.com/projects/demo-sec-1/locations/europe-west3/keyRings/kr-europe-west3/cryptoKeys/cmek-compute';
const DECOMMISSIONED = '//cloudresourcemanager.googleapis.com/projects/10000000006';
const BASTION = '//compute.googleapis.com/projects/demo-vm-1/zones/europe-west3-a/instances/bastion';

describe('locateNode', () => {
  it('jumps to a node the view draws as itself', () => {
    const answer = locateNode(S, view('S'), WEB_VM);
    expect(answer.kind).toBe('shown');
    expect(answer.kind === 'shown' ? answer.context.label : '').toBe('web-1mnl');
  });

  it('opens the chips around a node, and the view with those flips draws it', () => {
    const spec = view('M');
    expect(shownIn(M, spec, BASTION)).not.toBe(BASTION);
    const answer = locateNode(M, spec, BASTION);
    if (answer.kind !== 'expand') throw new Error(`expected expand, got ${answer.kind}`);
    expect(answer.view.flips.length).toBeGreaterThan(0);
    expect(answer.opened).toContain('Retail batch VMs (prod)');
    expect(shownIn(M, answer.view, BASTION)).toBe(BASTION);
    // Nothing but the flips changed.
    expect({ ...answer.view, flips: [] }).toEqual({ ...spec, flips: [] });
  });

  it('offers to drill in to the project of a node outside the drill-in root', () => {
    const answer = locateNode(S, view('S', { root: WEB_PROJECT }), ORDERS_API);
    if (answer.kind !== 'offer') throw new Error(`expected offer, got ${answer.kind}`);
    expect(answer.facts.outsideRoot).toBe(true);
    expect(offersOf(answer)).toEqual([['drill-in']]);
    expect(answer.offers[0]?.view.root).toBe(SVC_PROJECT);
    expect(answer.context).toMatchObject({
      root: 'Retail web (prod)',
      drillTarget: 'Retail services (prod)',
    });
    expect(shownIn(S, answer.offers[0]?.view ?? view('S'), ORDERS_API)).toBe(ORDERS_API);
  });

  it('offers to drill in, without the focus, for a node outside the focus view', () => {
    const answer = locateNode(
      S,
      view('S', { focus: { kind: 'project', params: { project: 'demo-web-1' } } }),
      ORDERS_API,
    );
    if (answer.kind !== 'offer') throw new Error(`expected offer, got ${answer.kind}`);
    expect(answer.facts.outsideFocus).toBe(true);
    expect(offersOf(answer)).toEqual([['drill-in']]);
    expect(answer.offers[0]?.view.focus).toBeUndefined();
  });

  it('offers the Everything lens or the type for a node the lens does not draw', () => {
    const answer = locateNode(S, view('S', { lens: 'networking' }), KMS_KEY);
    if (answer.kind !== 'offer') throw new Error(`expected offer, got ${answer.kind}`);
    expect(answer.facts.lens).toBe('unlisted');
    expect(offersOf(answer)).toEqual([['everything-lens'], ['include-type']]);
    expect(answer.offers[0]?.view.lens).toBe('everything');
    expect(answer.offers[1]?.view.filters.includeTypes).toEqual(['cloudkms.googleapis.com/CryptoKey']);
    for (const offer of answer.offers) expect(shownIn(S, offer.view, KMS_KEY)).toBe(KMS_KEY);
  });

  it('switches to the Everything lens with the Lens picker’s detail rule', () => {
    // At networking's own level (as an older link holds it): the level follows the lens, so Everything opens at
    // auto, its chips opened around the node where needed.
    const following = locateNode(M, view('M', { lens: 'networking', detail: 'networks' }), KMS_KEY_M);
    if (following.kind !== 'offer') throw new Error(`expected offer, got ${following.kind}`);
    const everything = following.offers.find((offer) => offer.steps.includes('everything-lens'));
    expect(everything?.view).toMatchObject({ lens: 'everything', detail: 'auto' });
    expect(shownIn(M, everything?.view ?? view('M'), KMS_KEY_M)).toBe(KMS_KEY_M);
    // A level the person chose stays.
    const spec = view('S', { lens: 'networking', detail: 'projects' });
    expect(applySteps(S, spec, nodeOf(S.graph, KMS_KEY), ['everything-lens'])).toMatchObject({
      lens: 'everything',
      detail: 'projects',
    });
    expect(lensDefaultsOf(catalog)).toMatchObject({ overview: 'auto', networking: 'networks' });
  });

  it('offers to include a hidden-role type first', () => {
    const build = Object.keys(S.graph.nodes).find(
      (id) => id.includes('cloudbuild.googleapis.com/') && id.includes('/builds/'),
    );
    if (build === undefined) throw new Error('demo S has no Cloud Build build');
    expect(nodeOf(S.graph, build).role).toBe('hidden');
    const answer = locateNode(S, view('S'), build);
    if (answer.kind !== 'offer') throw new Error(`expected offer, got ${answer.kind}`);
    expect(answer.facts.hidden).toBe('role');
    expect(offersOf(answer)[0]).toEqual(['include-type']);
    for (const offer of answer.offers) expect(shownIn(S, offer.view, build)).toBe(build);
  });

  it('offers only the Everything lens for a node its type’s hidden-by-default rule matched', () => {
    expect(nodeOf(S.graph, DECOMMISSIONED).hiddenWhenMatched).toBe(true);
    const answer = locateNode(S, view('S'), DECOMMISSIONED);
    if (answer.kind !== 'offer') throw new Error(`expected offer, got ${answer.kind}`);
    expect(answer.facts.hidden).toBe('when');
    expect(offersOf(answer)).toEqual([['everything-lens']]);
  });

  it('includes an excluded type again, lifting the exclusion', () => {
    const answer = locateNode(
      S,
      view('S', { filters: { excludeTypes: ['compute.googleapis.com/*'] } }),
      WEB_VM,
    );
    if (answer.kind !== 'offer') throw new Error(`expected offer, got ${answer.kind}`);
    expect(answer.facts.lens).toBe('excluded');
    expect(offersOf(answer)).toEqual([['include-type']]);
    expect(answer.offers[0]?.view.filters.excludeTypes).toBeUndefined();
    expect(answer.offers[0]?.view.filters.includeTypes).toEqual(['compute.googleapis.com/Instance']);
  });

  it('offers to clear the filters that leave a node out', () => {
    const answer = locateNode(S, view('S', { filters: { regions: ['us-central1'] } }), WEB_VM);
    if (answer.kind !== 'offer') throw new Error(`expected offer, got ${answer.kind}`);
    expect(answer.facts.filtered).toBe(true);
    expect(offersOf(answer)).toEqual([['clear-filters']]);
    expect(answer.offers[0]?.view.filters.regions).toBeUndefined();
  });

  it('knows no node it does not have, nor the organisation (the canvas)', () => {
    expect(locateNode(S, view('S'), '//compute.googleapis.com/projects/demo-web-1/instances/none').kind).toBe(
      'missing',
    );
    const organisation = Object.values(S.graph.nodes).find((node) =>
      node.assetType.endsWith('/Organization'),
    );
    expect(locateNode(S, view('S'), organisation?.id ?? '').kind).toBe('missing');
  });
});

describe('drillTarget and applySteps', () => {
  it('drills into the node’s project, or a project’s folder', () => {
    expect(drillTarget(S.graph, ORDERS_API)).toBe(SVC_PROJECT);
    expect(drillTarget(S.graph, WEB_PROJECT)).toMatch(/\/folders\//);
  });

  it('clears place and emptiness filters but keeps the type filters', () => {
    const spec = view('S', {
      filters: {
        hideEmptyProjects: true,
        hideDisconnected: true,
        regions: ['us-central1'],
        depth: 2,
        includeTypes: ['run.googleapis.com/Service'],
        showIdentities: false,
      },
    });
    const cleared = applySteps(S, spec, nodeOf(S.graph, WEB_VM), ['clear-filters']).filters;
    expect(cleared).toEqual({
      hideEmptyProjects: false,
      hideEmptyFolders: false,
      hideDisconnected: false,
      includeTypes: ['run.googleapis.com/Service'],
    });
  });
});
