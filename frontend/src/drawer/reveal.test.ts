// @vitest-environment node
// SPDX-License-Identifier: MIT
/**
 * Showing a jump link's target: the flips that open the collapsed zones around a node, worked out
 * with the scene builder itself (drawer/reveal.ts), and the camera's reveal pan (diagram/camera.ts
 * `revealTransform`), which keeps a node and its trace in view beside the drawer without changing the scale.
 */
import { catalog } from '@gcportrait/catalog';
import { buildSceneWithReport, viewportBudget } from '@gcportrait/graph';
import { decodeViewSpec, type Graph, type SceneEnv } from '@gcportrait/model';
import { beforeAll, describe, expect, it } from 'vitest';

import { REVEAL_MARGIN, revealTransform } from '../diagram/camera';
import { demoGraph } from '../diagram/testing/demoScenes';
import { revealFlips } from './reveal';

const VM = '//compute.googleapis.com/projects/demo-vm-1/zones/europe-west3-a/instances/bastion';
const SUBNET =
  '//compute.googleapis.com/projects/demo-net-1/regions/europe-west3/subnetworks/demo-vm-1-europe-west3';

describe('revealFlips on demo organisation M', () => {
  let graph: Graph;
  let env: SceneEnv;

  beforeAll(async () => {
    const demo = await demoGraph('M');
    const { snapshot } = demo;
    graph = demo.graph;
    env = {
      readTime: snapshot.readTime,
      rootLabel: 'example.com',
      viewportBudget: viewportBudget(1280, 624),
    };
  }, 60_000);

  const shownAs = (hash: string, flips: readonly string[], node: string): string | undefined => {
    const spec = { ...decodeViewSpec(hash), flips: [...flips], selection: node };
    return buildSceneWithReport(graph, spec, catalog, env).report.selection?.shownAs;
  };

  it('opens the chips around a VM hidden at the folder level, and only those', () => {
    const hash = 'snapshot=demo:M';
    expect(shownAs(hash, [], VM)).not.toBe(VM);
    const answer = revealFlips(graph, decodeViewSpec(hash), catalog, env, VM);
    expect(answer.shown).toBe(true);
    expect(answer.flips.length).toBeGreaterThan(0);
    expect(shownAs(hash, answer.flips, VM)).toBe(VM);
  });

  it('opens a subnet in another project (the Shared VPC host) the same way', () => {
    const hash = 'snapshot=demo:M&lens=networking';
    const answer = revealFlips(graph, decodeViewSpec(hash), catalog, env, SUBNET);
    expect(answer.shown).toBe(true);
    expect(shownAs(hash, answer.flips, SUBNET)).toBe(SUBNET);
  });

  it('keeps the flips of a node already drawn, and the view’s own flips', () => {
    const hash = 'snapshot=demo:M&lens=compute&detail=all&flips=abc123';
    const answer = revealFlips(graph, decodeViewSpec(hash), catalog, env, VM);
    expect(answer).toEqual({ shown: true, flips: ['abc123'] });
  });

  it('says a node the lens leaves out cannot be shown, and changes nothing', () => {
    // The networking lens draws no disks.
    const hash = 'snapshot=demo:M&lens=networking&flips=abc123';
    const disk = '//compute.googleapis.com/projects/demo-vm-1/zones/europe-west3-a/disks/bastion';
    expect(revealFlips(graph, decodeViewSpec(hash), catalog, env, disk)).toEqual({
      shown: false,
      flips: ['abc123'],
    });
  });
});

describe('revealTransform (the drawer’s camera pan)', () => {
  const camera = { x: 0, y: 0, k: 1 };
  const node = (x: number, y: number) => ({ x, y, width: 200, height: 44 });

  it('does not move when the node and its trace are in view', () => {
    expect(revealTransform(node(100, 100), node(100, 100), 800, 600, camera)).toBeNull();
  });

  it('pans as little as it can to bring a node behind the drawer back into view, at the same scale', () => {
    // The drawer took the right 400 px: the canvas is now 800 px wide and the node sits at x 900.
    const to = revealTransform(node(900, 100), node(900, 100), 800, 600, camera);
    expect(to).toEqual({ k: 1, x: 800 - REVEAL_MARGIN - 1100, y: 0 });
  });

  it('keeps the whole trace in view when it fits', () => {
    const extent = { x: 300, y: 100, width: 800, height: 300 };
    const to = revealTransform(node(900, 100), extent, 800, 600, { x: 0, y: 0, k: 0.8 });
    if (to === null) throw new Error('expected a pan');
    expect(to.k).toBe(0.8);
    expect(300 * 0.8 + to.x).toBeGreaterThanOrEqual(REVEAL_MARGIN - 1e-9);
    expect((300 + 800) * 0.8 + to.x).toBeLessThanOrEqual(800 - REVEAL_MARGIN + 1e-9);
  });

  it('fills the view with a trace larger than it, keeping the node in view', () => {
    const extent = { x: -2000, y: 0, width: 4000, height: 200 };
    const to = revealTransform(node(1500, 0), extent, 800, 600, camera);
    if (to === null) throw new Error('expected a pan');
    const left = 1500 + to.x;
    expect(left).toBeGreaterThanOrEqual(REVEAL_MARGIN);
    expect(left + 200).toBeLessThanOrEqual(800 - REVEAL_MARGIN);
  });

  it('centres a node larger than the canvas', () => {
    const big = { x: 0, y: 0, width: 2000, height: 100 };
    const to = revealTransform(big, big, 800, 600, { x: 500, y: 0, k: 1 });
    expect(to?.x).toBeCloseTo(400 - 1000);
  });
});
