// SPDX-License-Identifier: MIT
/**
 * The SVG scene graph against the style skill (gcp-diagram-style §2–§7, §11): tints and strokes per zone kind,
 * title positions and halos, cards, chips, icons (unaltered, plated on dark), edges and their markers per
 * relation kind and theme, dim mode, bundles, overlays, the legend and the title block, accessible names.
 */
import { DEFAULT_SIZING, TEXT_WEIGHTS } from '@gcportrait/layout';
import { iconFor, placeIcon } from '@gcportrait/icons';
import type { RelationKind, SceneEdge } from '@gcportrait/model';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { TAGLINE } from '../branding';
import { accessibleName, cardTypeName, DiagramDrawing, planDrawing } from './Drawing';
import { placeIconMarkup } from './icons';
import { fitText } from './geometry/text';
import { buildDiagramModel } from './model';
import { renderDiagramSvg } from './static';
import { one, renderDrawing as render } from './testing/drawing';
import {
  card,
  denseCards,
  denseEdges,
  denseScene,
  modelOf,
  scene,
  smallScene,
  TRACE_EDGES,
  zone,
} from './testing/scenes';
import { PALETTES } from './theme/tokens';

const node = (doc: Document, id: string): Element => one(doc, `[data-id="${id}"]`);
const body = (doc: Document, id: string): Element => one(node(doc, id), '.dg-body');

const EDGES: Array<readonly [string, string, SceneEdge['kind']]> = [
  ['run/web', 'run/api', 'uses'],
  ['run/jobs', 'pools/default', 'routes'],
  ['networks/vpc', 'projects/data', 'peers'],
  ['run/api', 'projects/data', 'connects'],
  ['pools/default', 'run/web', 'memberOf'],
  ['run/web', 'run/jobs', 'replicates'],
  ['run/jobs', 'projects/data', 'shares'],
  ['clusters/gke', 'networks/vpc', 'secures'],
];

describe.each(['light', 'dark'] as const)('zones and nodes, %s theme', (theme) => {
  const palette = PALETTES[theme];
  const model = modelOf(smallScene(EDGES));
  const doc = render(model, { theme });

  it('tints each zone kind with its §2 fill and stroke, and the §4 stroke width', () => {
    expect(body(doc, 'folders/1').getAttribute('fill')).toBe(palette.zone.folder.fill);
    expect(body(doc, 'folders/1').getAttribute('stroke')).toBe(palette.zone.folder.stroke);
    expect(body(doc, 'folders/1').getAttribute('stroke-width')).toBe('1');
    expect(body(doc, 'projects/web').getAttribute('fill')).toBe(palette.zone.project.fill);
    expect(body(doc, 'projects/web').getAttribute('stroke-width')).toBe('1.5');
    expect(body(doc, 'networks/vpc').getAttribute('fill')).toBe(palette.zone.vpc.fill);
    expect(body(doc, 'subnets/a').getAttribute('fill')).toBe(palette.zone.subnet.fill);
    expect(body(doc, 'subnets/a').getAttribute('stroke')).toBe(palette.zone.subnet.stroke);
    // folder (1) › project (2) › cluster (3): a nested product container.
    expect(body(doc, 'clusters/gke').getAttribute('fill')).toBe(palette.zone.nested.fill);
    expect(body(doc, 'folders/1').getAttribute('rx')).toBe('10');
  });

  it('puts folder titles top-left and every other title centred, with a halo in the zone fill', () => {
    const folderRect = model.input.layout.rects['folders/1'];
    const folderTitle = node(doc, 'folders/1').querySelector('text.dg-label');
    expect(Number(folderTitle?.getAttribute('x'))).toBe(
      (folderRect?.x ?? 0) +
        (folderRect?.padding ?? 0) +
        DEFAULT_SIZING.headerIcon +
        DEFAULT_SIZING.headerIconGap,
    );
    const projectRect = model.input.layout.rects['projects/web'];
    const projectTitle = node(doc, 'projects/web').querySelector('text.dg-label');
    const titleX = Number(projectTitle?.getAttribute('x'));
    expect(titleX).toBeGreaterThan((projectRect?.x ?? 0) + (projectRect?.padding ?? 0) + 40);
    for (const title of [folderTitle, projectTitle]) {
      expect(title?.getAttribute('paint-order')).toBe('stroke');
      expect(title?.getAttribute('stroke-width')).toBe('4');
    }
    expect(projectTitle?.getAttribute('stroke')).toBe(palette.zone.project.fill);
  });

  it('writes the id after a middle dot, in muted where muted is readable on the tint, else in mutedOnTint', () => {
    const folderId = node(doc, 'folders/1').querySelector('tspan.dg-sub');
    expect(folderId?.textContent).toBe(' · folder 20000000001');
    expect(folderId?.getAttribute('fill')).toBe(palette.muted);
    // muted is below 4.5 : 1 on the project tint in both themes (theme.test.ts); the id stays lighter than ink.
    const projectId = node(doc, 'projects/web').querySelector('tspan.dg-sub');
    expect(projectId?.getAttribute('fill')).toBe(palette.mutedOnTint);
    expect(projectId?.getAttribute('fill')).not.toBe(palette.ink);
  });

  it('draws badges as surface pills with muted text, top-right of the header', () => {
    const badge = node(doc, 'networks/vpc').querySelector('rect[rx="9"]');
    expect(badge?.getAttribute('fill')).toBe(palette.surface);
    expect(badge?.nextElementSibling?.textContent).toBe('shared with 2 projects');
    expect(badge?.nextElementSibling?.getAttribute('fill')).toBe(palette.muted);
  });

  it('draws cards 44 px high with radius 8, a 1.5 px outline, a 24 px icon, a 13/700 title and a 10.5 subtitle', () => {
    const element = node(doc, 'run/api');
    const rect = element.querySelector('.dg-body');
    expect(rect?.getAttribute('height')).toBe('44');
    expect(rect?.getAttribute('rx')).toBe('8');
    expect(rect?.getAttribute('fill')).toBe(palette.card.fill);
    expect(rect?.getAttribute('stroke')).toBe(palette.card.stroke);
    expect(rect?.getAttribute('stroke-width')).toBe('1.5');
    expect(element.querySelector('use')?.getAttribute('href')).toBe('#dg-icon-cloud_run');
    const title = element.querySelector('text.dg-label');
    expect([title?.getAttribute('font-size'), title?.getAttribute('font-weight')]).toEqual(['13', '700']);
    const subtitle = element.querySelector('text.dg-sub');
    expect(subtitle?.getAttribute('font-size')).toBe('10.5');
    // The address is set in Roboto Mono, the rest in the label stack (the layout measured it so).
    expect(subtitle?.querySelector('tspan')?.getAttribute('font-family')).toContain('Roboto Mono');
  });

  it('defines each icon once, unaltered: the artwork is placed, never edited', () => {
    const icon = iconFor('cloud_run');
    if (icon === undefined) throw new Error('cloud_run icon missing');
    const markup = renderToStaticMarkup(
      <svg>
        <DiagramDrawing
          model={model}
          options={{ theme, overlays: false, interactive: false, utcOffsetMinutes: 0 }}
          plan={planDrawing(model, { overlays: false, utcOffsetMinutes: 0 })}
        />
      </svg>,
    );
    expect(markup).toContain(placeIcon(icon, 24));
    // The UI thread's own placement (icons.ts) is the icons package's, byte for byte, for every icon drawn.
    for (const drawn of planDrawing(model, { overlays: false, utcOffsetMinutes: 0 }).icons)
      expect(placeIconMarkup(drawn, 24, 3, 4)).toBe(placeIcon(drawn, 24, 3, 4));
    expect(doc.querySelectorAll('#dg-icon-cloud_run')).toHaveLength(1);
    // Google's colour marks sit on a light plate on dark canvases only (skill §2).
    const plates = node(doc, 'run/api').querySelectorAll('rect[fill="#FFFFFF"][fill-opacity="0.92"]');
    expect(plates).toHaveLength(theme === 'dark' && icon.plateOnDark ? 1 : 0);
  });

  it('draws a collapsed zone as a chip in its tint with a 1 px stroke, its kind mark, the ⊞ glyph and the count line', () => {
    const chip = node(doc, 'projects/data');
    expect(chip.getAttribute('class')).toContain('dg-chip');
    expect(chip.querySelector('.dg-body')?.getAttribute('fill')).toBe(palette.zone.project.fill);
    expect(chip.querySelector('.dg-body')?.getAttribute('stroke-width')).toBe('1');
    // The zone's header mark beside the label (the kind is never shown by the tint alone), 14 px, defined
    // once like every icon; the ⊞ glyph below it, beside the count line.
    const mark = chip.querySelector('.dg-chip-mark');
    expect(mark?.querySelector('use')?.getAttribute('href')).toBe('#dg-icon-project');
    expect(mark?.getAttribute('transform')).toMatch(/ scale\(0\.58\)$/);
    expect(doc.querySelector('defs #dg-icon-project')).not.toBeNull();
    const glyph = chip.querySelector(':scope > use');
    expect(glyph?.getAttribute('href')).toBe('#dg-chip-glyph');
    const label = chip.querySelector('text.dg-label');
    const markTop = Number(/translate\([\d.]+ ([\d.]+)\)/.exec(mark?.getAttribute('transform') ?? '')?.[1]);
    expect(markTop).toBeLessThan(Number(glyph?.getAttribute('y')));
    expect(Number(label?.getAttribute('y'))).toBeLessThan(
      Number(chip.querySelector('text.dg-sub')?.getAttribute('y')),
    );
    expect(chip.querySelector('text.dg-sub')?.textContent).toMatch(/^2 net(work)?s? · 39 res/);
    expect(chip.querySelector('text.dg-label')?.getAttribute('fill')).toBe(palette.chipText);
  });

  it('never sets text below 10.5 px at scale 1', () => {
    const sizes = [...doc.querySelectorAll('[font-size]')].map((element) =>
      Number(element.getAttribute('font-size')),
    );
    expect(sizes.length).toBeGreaterThan(10);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(10.5);
  });

  it.each([
    '2 networks · 39 resources',
    '2 net · 39 res',
    '',
    undefined,
    '12 fld · 140 prj · 31 net · 412 sub · 96 ctr · 4821 res',
  ])('draws the layout-selected count line %j without choosing again', (chipCountLine) => {
    const id = 'projects/data';
    const rect = model.input.layout.rects[id];
    if (rect === undefined) throw new Error('the fixture must contain its collapsed project');
    const baseRect = { ...rect };
    delete baseRect.chipCountLine;
    const chosen = buildDiagramModel({
      ...model.input,
      layout: {
        ...model.input.layout,
        rects: {
          ...model.input.layout.rects,
          [id]: { ...baseRect, width: 220, ...(chipCountLine === undefined ? {} : { chipCountLine }) },
        },
      },
    });
    const chip = node(render(chosen, { theme, interactive: true }), id);
    const room =
      220 - 2 * DEFAULT_SIZING.cardPadding - DEFAULT_SIZING.chipGlyph - DEFAULT_SIZING.chipGlyphGap;
    expect(chip.querySelector('text.dg-sub')?.textContent).toBe(
      fitText(chipCountLine ?? '', TEXT_WEIGHTS.cardSubtitle, DEFAULT_SIZING.cardSubtitleSize, room),
    );
    expect(chip.getAttribute('aria-label')).toBe('Project: Analytics, collapsed, 2 networks · 39 resources');
  });
});

describe('edges (style skill §5)', () => {
  const model = modelOf(smallScene(EDGES));

  it.each(['light', 'dark'] as const)(
    'defines an end and a start marker per relation kind with a head, per theme (%s)',
    (theme) => {
      const doc = render(model, { theme });
      const ids = [...doc.querySelectorAll('marker')].map((marker) => marker.id);
      // The kinds drawn, in the model's relation-kind order, written out here rather than read from that list.
      expect(ids).toEqual(
        (['routes', 'uses', 'peers', 'memberOf', 'replicates', 'shares'] satisfies RelationKind[]).flatMap(
          (kind) => [`dg-${theme}-head-${kind}`, `dg-${theme}-head-${kind}-start`],
        ),
      );
      const palette = PALETTES[theme];
      const shape = (id: string) => doc.querySelector(`#dg-${theme}-head-${id} path`);
      expect(shape('uses')?.getAttribute('fill')).toBe(palette.edge);
      expect(shape('uses')?.getAttribute('d')).toBe('M0 -3.5L9 0L0 3.5Z');
      expect(shape('uses-start')?.getAttribute('d')).toBe('M0 -3.5L-9 0L0 3.5Z');
      expect(shape('shares')?.getAttribute('d')).toBe('M0 -2.5L7 0L0 2.5Z');
      expect(shape('memberOf')?.getAttribute('fill')).toBe('none');
      expect(shape('memberOf')?.getAttribute('d')).toBe('M0 -2.5L7 0L0 2.5');
      expect(doc.querySelector(`#dg-${theme}-head-memberOf`)?.getAttribute('refX')).toBe('7');
      expect(doc.querySelector(`#dg-${theme}-head-memberOf-start`)?.getAttribute('refX')).toBe('-7');
      expect(shape('replicates')?.getAttribute('fill')).toBe(palette.canvas);
      for (const marker of doc.querySelectorAll('marker')) {
        expect(marker.getAttribute('markerUnits')).toBe('userSpaceOnUse');
        // Plain `auto` (not SVG 2's auto-start-reverse), so every renderer and editor orients the heads alike.
        expect(marker.getAttribute('orient')).toBe('auto');
      }
    },
  );

  it('keeps each kind’s dash rhythm on its traced copy, scaled to the trace width (skill §6)', () => {
    const doc = render(model, { interactive: true });
    // The interactive canvas's prototype of each kind, which the painter clones for a traced line.
    const traced = (kind: string): Element | null | undefined =>
      doc.querySelector(`.dg-edges-top .dg-edge-proto[data-kind="${kind}"] .dg-edge`);
    // memberOf `1 3` at 1.2 px stays dots at 3 px; peers `6 5` and shares `8 4` keep their proportions.
    expect(traced('memberOf')?.getAttribute('stroke-dasharray')).toBe('2.5 7.5');
    expect(traced('peers')?.getAttribute('stroke-dasharray')).toBe('9 7.5');
    expect(traced('shares')?.getAttribute('stroke-dasharray')).toBe('16 8');
    expect(traced('uses')?.getAttribute('stroke-dasharray')).toBeNull();
    expect(traced('memberOf')?.getAttribute('stroke-width')).toBe('3');
  });

  it('draws each kind with its stroke, dash and heads', () => {
    const doc = render(model);
    const paths = [...doc.querySelectorAll('.dg-edges path')];
    const byMarker = (kind: string) =>
      paths.find((path) =>
        (path.getAttribute('marker-end') ?? path.getAttribute('marker-start') ?? '').includes(
          `head-${kind})`,
        ),
      );
    expect(byMarker('uses')?.getAttribute('stroke-width')).toBe('2');
    expect(byMarker('peers')?.getAttribute('stroke-dasharray')).toBe('6 5');
    expect(byMarker('peers')?.getAttribute('marker-start')).toBe('url(#dg-light-head-peers-start)');
    expect(byMarker('peers')?.getAttribute('marker-end')).toBe('url(#dg-light-head-peers)');
    expect(byMarker('memberOf')?.getAttribute('stroke-dasharray')).toBe('1 3');
    expect(byMarker('memberOf')?.getAttribute('stroke-width')).toBe('1.2');
    expect(byMarker('shares')?.getAttribute('stroke-dasharray')).toBe('8 4');
    expect(byMarker('shares')?.getAttribute('stroke-width')).toBe('1.5');
    const connects = paths.find((path) => path.getAttribute('stroke-linecap') === 'round');
    expect(connects?.getAttribute('marker-end')).toBeNull();
    expect(connects?.getAttribute('marker-start')).toBeNull();
    expect(doc.querySelector('.dg-edges')?.getAttribute('stroke')).toBe(PALETTES.light.edge);
    // Every path is orthogonal with arcs at the elbows: only M, L, A commands, no diagonals.
    for (const path of paths) {
      const d = path.getAttribute('d') ?? '';
      expect(d).toMatch(/^M[\d.-]+ [\d.-]+([LA][^MLA]*)*$/);
    }
  });

  it('draws secures as a dashed accent.path overlay at 50 % on its casing inside the target, under the lines', () => {
    const doc = render(model);
    const [casing, backing, overlay] = [...doc.querySelectorAll('.dg-overlays rect')];
    expect(backing?.getAttribute('stroke')).toBe(PALETTES.light.canvas);
    expect(backing?.getAttribute('stroke-dasharray')).toBe('6 4');
    expect(overlay?.getAttribute('stroke')).toBe(PALETTES.light.accentPath);
    expect(overlay?.getAttribute('stroke-opacity')).toBe('0.5');
    expect(overlay?.getAttribute('stroke-dasharray')).toBe('6 4');
    expect(overlay?.getAttribute('stroke-width')).toBe('2');
    // Under it, the same dashes in pathCasing, 1 px wider on each side (theme.test.ts: 3 : 1 against it).
    expect(casing?.getAttribute('class')).toBe('dg-overlay-casing');
    expect(casing?.getAttribute('stroke')).toBe(PALETTES.light.pathCasing);
    expect(casing?.getAttribute('stroke-dasharray')).toBe('6 4');
    expect(casing?.getAttribute('stroke-width')).toBe('4');
    expect(casing?.getAttribute('x')).toBe(overlay?.getAttribute('x'));
    // Inside the target's border, not in the gutter the lines run in.
    const vpc = model.input.layout.rects['networks/vpc'];
    expect(Number(overlay?.getAttribute('x'))).toBe((vpc?.x ?? 0) + 4);
    expect(Number(overlay?.getAttribute('width'))).toBe((vpc?.width ?? 0) - 8);
    expect(model.lines.some((edge) => edge.path.kind === 'secures')).toBe(false);
    // Painted before the lines, so every line runs over it.
    const order = [...(doc.querySelector('.dg-drawing')?.children ?? [])].map((child) =>
      child.getAttribute('class'),
    );
    expect(order.indexOf('dg-overlays')).toBeLessThan(order.indexOf('dg-edges'));
    expect(render(model, { theme: 'dark' }).querySelector('.dg-overlay-casing')?.getAttribute('stroke')).toBe(
      PALETTES.dark.pathCasing,
    );
  });

  it('names the policy of each overlay in its title, and the target in data-secures', () => {
    const doc = render(model);
    const overlay = doc.querySelector('.dg-overlay');
    expect(overlay?.getAttribute('data-secures')).toBe('networks/vpc');
    expect(overlay?.querySelector('title')?.textContent).toBe('secures — retail-prod');
    const two = modelOf(
      smallScene([
        ['clusters/gke', 'networks/vpc', 'secures'],
        ['run/jobs', 'networks/vpc', 'secures'],
      ]),
    );
    expect(render(two).querySelector('.dg-overlay title')?.textContent).toBe('secures — 2 policies');
  });

  it('draws a long policy cut in the legend row, and in full in the row’s and the overlay’s titles', () => {
    // Where the legend cuts the label is legend.test.ts's; here, that the drawing shows the cut label and the full
    // name in both <title>s.
    const long = 'org-wide-baseline-for-every-production-workload-in-europe-and-the-americas';
    const policy = modelOf(
      scene(
        [
          zone('projects/p', 'project', 'p', [
            card('policies/long', long),
            zone('networks/v', 'vpc', 'v', [card('run/a', 'a')]),
          ]),
        ],
        [{ from: 'policies/long', to: 'networks/v', kind: 'secures' }],
      ),
    );
    const doc = render(policy);
    const titles = [...one(doc, '.dg-legend').querySelectorAll('title')].map((title) => title.textContent);
    expect(titles).toEqual([`secures — ${long}`]);
    const texts = [...one(doc, '.dg-legend').querySelectorAll('text')].map((text) => text.textContent);
    expect(texts.some((text) => text.startsWith('secures — org-wide') && text.endsWith('…'))).toBe(true);
    expect(texts).not.toContain(`secures — ${long}`);
    expect(one(doc, '.dg-overlay title').textContent).toBe(`secures — ${long}`);
  });
});

describe('dim mode and focus copies (skill §5)', () => {
  const model = modelOf(denseScene(31));

  it('dims every line above 30: edge.dim, 1.2 px, and keeps its head at 7 × 5 in edge.dim', () => {
    const doc = render(model);
    const group = doc.querySelector('.dg-edges');
    expect(group?.getAttribute('stroke')).toBe(PALETTES.light.edgeDim);
    expect(group?.getAttribute('stroke-width')).toBe('1.2');
    for (const path of doc.querySelectorAll('.dg-edges path')) {
      expect(path.getAttribute('marker-end')).toBe('url(#dg-light-dimhead-uses)');
      expect(path.getAttribute('stroke-width')).toBeNull();
    }
    const head = doc.querySelector('#dg-light-dimhead-uses path');
    expect(head?.getAttribute('fill')).toBe(PALETTES.light.edgeDim);
    expect(head?.getAttribute('d')).toBe('M0 -2.5L7 0L0 2.5Z');
    // The line stops at the head's base, so the head's tip lands where the layout ended the edge.
    const [edge] = model.lines;
    const path = doc.querySelector('.dg-edges path');
    const end = edge?.path.points.at(-1);
    const drawnEnd = /([\d.-]+) ([\d.-]+)$/.exec(path?.getAttribute('d') ?? '');
    const gap = Math.hypot(Number(drawnEnd?.[1]) - (end?.x ?? 0), Number(drawnEnd?.[2]) - (end?.y ?? 0));
    expect(gap).toBeCloseTo(7, 5);
    // No ink heads in dim mode: only the legend's samples use them.
    expect(doc.querySelector('#dg-light-head-uses')).not.toBeNull();
    expect(
      [...doc.querySelectorAll('.dg-edges path')].some((p) =>
        (p.getAttribute('marker-end') ?? '').includes('-head-'),
      ),
    ).toBe(false);
  });

  it('keeps one hidden traced-line prototype per relation kind on top: accent.select 3 px on a 4 px canvas casing', () => {
    const doc = render(model, { interactive: true });
    // No pre-drawn copy of every line (31 here); one prototype per kind drawn, which the painter clones.
    expect(doc.querySelectorAll('.dg-edges-top .dg-edge-top')).toHaveLength(0);
    const prototypes = [...doc.querySelectorAll('.dg-edges-top .dg-edge-proto')];
    const kinds = new Set(model.lines.map((edge) => edge.path.kind));
    expect(prototypes.map((element) => element.getAttribute('data-kind')).sort()).toEqual([...kinds].sort());
    expect(prototypes.every((element) => element.getAttribute('display') === 'none')).toBe(true);
    const first = doc.querySelector('.dg-edge-proto[data-kind="uses"]');
    expect(first?.querySelector('.dg-casing')?.getAttribute('stroke')).toBe(PALETTES.light.canvas);
    expect(first?.querySelector('.dg-casing')?.getAttribute('stroke-width')).toBe('11');
    expect(first?.querySelector('.dg-edge')?.getAttribute('stroke')).toBe(PALETTES.light.accentSelect);
    expect(first?.querySelector('.dg-edge')?.getAttribute('stroke-width')).toBe('3');
    expect(first?.querySelector('.dg-edge')?.getAttribute('d')).toBeNull();
    expect(first?.querySelector('.dg-edge')?.getAttribute('marker-end')).toBe(
      'url(#dg-light-tracehead-uses)',
    );
    expect(doc.querySelector('#dg-light-tracehead-uses path')?.getAttribute('fill')).toBe(
      PALETTES.light.accentSelect,
    );
    // No interactive scaffolding in a static drawing.
    expect(render(model).querySelector('.dg-edges-top')).toBeNull();
    expect(render(model).querySelector('.dg-marks')).toBeNull();
    expect(render(model).querySelector('.dg-console-action')).toBeNull();
  });

  it('draws a hub bundle from its shared end, with its shared head once', () => {
    // c0 uses c1…c11 (a shared source), and c1…c11 route to c0 (a shared target).
    const cards = denseCards();
    const hub: SceneEdge[] = [
      ...denseEdges(11),
      ...cards.slice(1).map((source) => ({ from: source.id, to: 'run/c0', kind: 'routes' as const })),
    ];
    const bundled = modelOf(scene([zone('projects/p', 'project', 'p', cards)], hub));
    expect(bundled.dim).toBe(false);
    const paths = [...render(bundled).querySelectorAll('.dg-edges path')];
    expect(paths).toHaveLength(bundled.lines.length);
    const heads = new Map<string, number>();
    const targetBundles = new Set<string>();
    bundled.lines.forEach((edge, index) => {
      const bundle = edge.path.bundle;
      const path = paths[index];
      if (bundle === undefined || path === undefined) return;
      if (bundle.end === 'source') {
        // The shared end has no head (heads at the targets): every member keeps its own.
        expect(path.getAttribute('marker-end')).toContain(`head-${edge.path.kind}`);
        return;
      }
      // Drawn from the shared target, so the head there is the path's start marker, drawn by one member.
      targetBundles.add(bundle.id);
      expect(path.getAttribute('marker-end')).toBeNull();
      if (path.getAttribute('marker-start') !== null) heads.set(bundle.id, (heads.get(bundle.id) ?? 0) + 1);
    });
    expect(targetBundles.size).toBeGreaterThan(0);
    for (const id of targetBundles) expect(heads.get(id), id).toBe(1);
  });
});

describe('the selection trace in a static drawing (skill §6)', () => {
  const model = modelOf(smallScene(TRACE_EDGES));

  it.each(['light', 'dark'] as const)('draws the selected node’s trace as it is (%s)', (theme) => {
    const palette = PALETTES[theme];
    const doc = render(model, { theme, selection: 'run/api' });
    // The path to the root: a 3 px accent.path ring on each zone around it, on its casing band.
    const rings = [...doc.querySelectorAll('.dg-path-ring')];
    expect(rings).toHaveLength(4);
    const vpc = model.input.layout.rects['networks/vpc'];
    expect(rings[1]?.querySelector('.dg-path-line')?.getAttribute('x')).toBe(String(vpc?.x));
    expect(rings[1]?.querySelector('.dg-path-line')?.getAttribute('stroke')).toBe(palette.accentPath);
    expect(rings[1]?.querySelector('.dg-path-line')?.getAttribute('stroke-width')).toBe('3');
    expect(rings[1]?.querySelector('.dg-path-casing')?.getAttribute('stroke')).toBe(palette.pathCasing);
    // The traced lines on top, and only those: both routes lines of the chain, not the unrelated one.
    const traced = [...doc.querySelectorAll('.dg-traced')].map((element) =>
      element.getAttribute('data-edge'),
    );
    expect(traced.sort()).toEqual(['run/api -routes-> pools/default', 'run/web -routes-> run/api']);
    expect(doc.querySelector('.dg-traced .dg-edge')?.getAttribute('stroke')).toBe(palette.accentSelect);
    // The reached nodes' rings (one path), and the selection ring around the node.
    const reach = doc.querySelector('.dg-reach-rings .dg-ring');
    expect(reach?.getAttribute('stroke')).toBe(palette.accentSelect);
    expect(reach?.getAttribute('stroke-width')).toBe('1.5');
    expect((reach?.getAttribute('d') ?? '').match(/M/g)).toHaveLength(2);
    expect(doc.querySelector('.dg-select-ring .dg-ring')?.getAttribute('stroke')).toBe(palette.accentSelect);
    // The legend's trace column, shown, and the panel as wide as it needs.
    const column = doc.querySelector('.dg-legend-trace');
    expect(column?.getAttribute('display')).toBeNull();
    expect(column?.textContent).toBe('selectedtracepath to root');
  });

  it('draws nothing of a trace for an unknown node, and the interactive legend keeps its column hidden', () => {
    expect(render(model, { selection: 'nowhere' }).querySelector('.dg-traced, .dg-path-ring')).toBeNull();
    const doc = render(model, { interactive: true });
    const column = doc.querySelector('.dg-legend-trace');
    expect(column?.getAttribute('display')).toBe('none');
    const panel = doc.querySelector('.dg-legend-panel');
    expect(Number(panel?.getAttribute('data-trace-width'))).toBeGreaterThan(
      Number(panel?.getAttribute('data-width')),
    );
    expect(panel?.getAttribute('width')).toBe(panel?.getAttribute('data-width'));
    // The frame already has room for the column, so a selection never moves the camera.
    const plan = planDrawing(model, { overlays: true, utcOffsetMinutes: 0, interactive: true });
    expect(plan.legend?.layout.trace).not.toBeNull();
  });
});

describe('legend and title block (skill §7)', () => {
  const model = modelOf(smallScene(EDGES), 'Networking');

  it('puts both inside the standalone SVG, naming the scope, the lens and the read time at the viewer’s offset', () => {
    // The tagline and the placement guard (no affiliation line in a drawing) are titleBlock.test.ts's and the
    // baselines'.
    const svg = renderDiagramSvg(model.input, { theme: 'light', utcOffsetMinutes: 120 });
    expect(svg).toContain('class="dg-legend"');
    expect(svg).toContain('class="dg-title-block"');
    expect(svg).toContain('>example.com<');
    expect(svg).toContain('Networking lens · read 2026-10-08T02:00:00+02:00');
    expect(svg).toMatch(/<title>gcportrait diagram of example\.com, Networking lens<\/title>/);
    expect(svg).toContain(
      '<desc>example.com, Networking lens, read 2026-10-08T02:00:00+02:00. Drawn with gcportrait.</desc>',
    );
  });

  it('draws the same three-line title block on the interactive canvas and in a standalone file', () => {
    const doc = render(model, { interactive: true });
    const lines = [...(doc.querySelector('.dg-title-block')?.querySelectorAll('text') ?? [])];
    expect(lines.map((line) => line.textContent)).toEqual([
      'example.com',
      'Networking lens · read 2026-10-08T00:00:00+00:00',
      TAGLINE,
    ]);
    const tagline = lines[2];
    expect([tagline?.getAttribute('font-size'), tagline?.getAttribute('font-weight')]).toEqual([
      '10.5',
      '400',
    ]);
    const exported = [...(render(model).querySelector('.dg-title-block')?.querySelectorAll('text') ?? [])];
    expect(exported.map((line) => line.outerHTML)).toEqual(lines.map((line) => line.outerHTML));
    // The same title band above the diagram, at the same place, on the canvas and in a file.
    const band = (interactive: boolean) => {
      const plan = planDrawing(model, { overlays: true, utcOffsetMinutes: 0, interactive });
      return { title: plan.title, top: plan.frame.y };
    };
    expect(band(false)).toEqual(band(true));
  });

  it('frames the title band above and the legend below the diagram, so nothing overlaps them', () => {
    const plan = planDrawing(model, { overlays: true, utcOffsetMinutes: 0 });
    const { bounds } = model.input.layout;
    expect(plan.title?.y).toBeLessThan(bounds.y);
    expect((plan.title?.y ?? 0) + (plan.title?.block.height ?? 0)).toBeLessThanOrEqual(bounds.y);
    expect(plan.legend?.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
    expect(plan.frame.y + plan.frame.height).toBeGreaterThan(
      (plan.legend?.y ?? 0) + (plan.legend?.layout.height ?? 0),
    );
  });

  it('draws no legend panel for an empty Scene, only the title block', () => {
    const empty = modelOf(scene([]));
    const plan = planDrawing(empty, { overlays: true, utcOffsetMinutes: 0 });
    expect(plan.legend).toBeNull();
    expect(plan.title).not.toBeNull();
    expect(Number.isFinite(plan.frame.width) && Number.isFinite(plan.frame.height)).toBe(true);
    const doc = render(empty);
    expect(doc.querySelector('.dg-legend')).toBeNull();
    expect(doc.querySelector('.dg-title-block')?.textContent).toContain(TAGLINE);
  });

  it('leaves both out of the interactive canvas when the setting hides them', () => {
    const doc = render(model, { overlays: false, interactive: true });
    expect(doc.querySelector('.dg-legend')).toBeNull();
    expect(doc.querySelector('.dg-title-block')).toBeNull();
    expect(planDrawing(model, { overlays: false, utcOffsetMinutes: 0 }).frame).toEqual(
      model.input.layout.bounds,
    );
  });
});

describe('accessible names (style skill §13)', () => {
  const model = modelOf(smallScene(EDGES));
  const doc = render(model, { interactive: true });

  it('names every card by type and label, as a button in the tab order', () => {
    const element = node(doc, 'run/api');
    expect(element.getAttribute('role')).toBe('button');
    expect(element.getAttribute('aria-label')).toBe('Cloud Run service: orders-api');
    expect(element.getAttribute('tabindex')).toBe('-1');
    for (const solid of doc.querySelectorAll('.dg-node'))
      expect(solid.getAttribute('aria-label')).toBeTruthy();
  });

  it('names a product container by its asset type when the data worker sent one, else by its kind', () => {
    expect(node(doc, 'clusters/gke').getAttribute('aria-label')).toBe('Container: retail-prod');
    const typed = buildDiagramModel({
      ...model.input,
      zoneTypes: { 'clusters/gke': 'Google Kubernetes Engine cluster' },
    });
    expect(node(render(typed, { interactive: true }), 'clusters/gke').getAttribute('aria-label')).toBe(
      'Google Kubernetes Engine cluster: retail-prod',
    );
  });

  it('names zones and chips by kind, label and id', () => {
    expect(node(doc, 'projects/web').getAttribute('aria-label')).toBe('Project: Retail web (demo-web-1)');
    expect(node(doc, 'projects/web').getAttribute('role')).toBe('graphics-object');
    expect(node(doc, 'projects/data').getAttribute('aria-label')).toBe(
      'Project: Analytics, collapsed, 2 networks · 39 resources',
    );
  });

  it.each([
    ['Cloud Run', 'run.googleapis.com/Service', 'Cloud Run service'],
    ['Cloud Load Balancing', 'compute.googleapis.com/ForwardingRule', 'Cloud Load Balancing forwarding rule'],
    ['Cloud SQL', 'sqladmin.googleapis.com/Instance', 'Cloud SQL instance'],
    ['Cloud DNS', 'dns.googleapis.com/ManagedZone', 'Cloud DNS managed zone'],
    // The product already names the kind: not "VPC network network".
    ['VPC network', 'compute.googleapis.com/Network', 'VPC network'],
    [
      'Identity and Access Management',
      'iam.googleapis.com/ServiceAccount',
      'Identity and Access Management service account',
    ],
    [
      'Cloud Key Management',
      'cloudkms.googleapis.com/CryptoKeyVersion',
      'Cloud Key Management crypto key version',
    ],
    // An acronym in the type stays in capitals.
    ['Compute Engine', 'compute.googleapis.com/VPNTunnel', 'Compute Engine VPN tunnel'],
  ])('builds the type name of %s’s %s: %s', (product, assetType, name) => {
    expect(cardTypeName(product, assetType)).toBe(name);
  });

  it('names a rect without a node by its id, and a chip that counts nothing as collapsed', () => {
    const rect = model.input.layout.rects['projects/data'];
    if (rect === undefined) throw new Error('missing rect');
    expect(accessibleName(undefined, rect, 'x')).toBe('x');
    // A chip that counts nothing (a ghost chip of which nothing is gone) says only that it is collapsed.
    const empty = zone('projects/data', 'project', 'Analytics', [], { collapsed: {} });
    expect(accessibleName(empty, rect, 'projects/data')).toBe('Project: Analytics, collapsed');
  });
});
