// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { DEFAULT_SIZING, TEXT_WEIGHTS, ZONE_TITLE_SEPARATOR } from './constants.js';
import { defaultFontMetrics, measureText } from './metrics.js';
import { chipWidth } from './chips.js';
import { normaliseScene } from './normalise.js';
import {
  basePaddingOf,
  cardWidth,
  headerHeightAt,
  headerMinWidth,
  sizeNodes,
  subtitleRuns,
  zoneTitleSizeAt,
  zoneTitleWidth,
  type SizingContext,
} from './size.js';
import { ORGANISATION_ID, card, scene, zone } from './testing/scenes.js';

const context: SizingContext = {
  sizing: DEFAULT_SIZING,
  metrics: defaultFontMetrics(),
  ringOf: () => 0,
  sidesOf: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
};

/** Padding + icon + padding + the wider of the title and the subtitle + padding, before the 148–220 clamp. */
const naturalCardWidth = (title: number, subtitle: number): number =>
  Math.ceil(30 + 24 + Math.max(title, subtitle));

describe('cardWidth', () => {
  it.each([
    ['the minimum width for a short label', 'a', undefined, { width: 148, truncated: false }],
    [
      // Set in Roboto alone the subtitle would be narrower than the title; the address in Roboto Mono widens it.
      'the wider text, with an address in the subtitle set in Roboto Mono',
      'tunnel-onprem-dc1-0',
      '203.0.113.13 · established',
      {
        width: naturalCardWidth(
          measureText('tunnel-onprem-dc1-0', 700, 13),
          measureText('203.0.113.13', 400, 10.5, { family: 'mono' }) +
            measureText(' · established', 400, 10.5),
        ),
        truncated: false,
      },
    ],
    [
      'the maximum width, truncating a long label',
      'eventarc-europe-west3-orders-handler-614468-sub-400',
      undefined,
      { width: 220, truncated: true },
    ],
    ['the maximum width, truncating a long subtitle', 'a', 'x'.repeat(200), { width: 220, truncated: true }],
  ])('is %s', (_name, label, subtitle, expected) => {
    expect(cardWidth(label, subtitle, context)).toEqual(expected);
  });
});

describe('subtitleRuns', () => {
  it('sets addresses in Roboto Mono and every other fact in Roboto', () => {
    expect(subtitleRuns('10.248.0.0/28 · e2-micro · europe-west3')).toEqual([
      { text: '10.248.0.0/28', family: 'mono' },
      { text: ' · e2-micro · europe-west3', family: 'sans' },
    ]);
    expect(subtitleRuns('external · 203.0.113.10 · fd00::1/64')).toEqual([
      { text: 'external · ', family: 'sans' },
      { text: '203.0.113.10', family: 'mono' },
      { text: ' · ', family: 'sans' },
      { text: 'fd00::1/64', family: 'mono' },
    ]);
    expect(subtitleRuns('10.0.0.0/8, 10.1.0.0/16')).toEqual([
      { text: '10.0.0.0/8, 10.1.0.0/16', family: 'mono' },
    ]);
  });

  it('recognises IPv4 and IPv6 addresses and CIDR ranges exactly', () => {
    const mono = [
      '0.0.0.0/0',
      '255.255.255.255',
      '10.128.0.0/10',
      '::',
      '::1',
      'fd20::/20',
      '2001:db8::/32',
      '2001:DB8:0:0:8:800:200C:417A',
      '2001:db8:0:0:0:0:0:1/128',
      '::ffff:192.0.2.1',
      '64:ff9b::192.0.2.33/96',
      '10.0.0.0/8, fd00::/8',
    ];
    for (const fact of mono) expect(subtitleRuns(fact), fact).toEqual([{ text: fact, family: 'mono' }]);
  });

  it('keeps words, ports, versions, times, dates, ids and machine types in Roboto', () => {
    const sans = [
      'TCP 80-80',
      '443',
      'e2-micro',
      'cafe',
      'priority 1000',
      'ASN 64512',
      'Café',
      '3.1.2',
      '1.33.4',
      '12:30',
      '12:30:45',
      '256.0.0.1',
      '10.0.0.0/33',
      '10.0.0.0/8/8',
      '10.0.0.4:443',
      '1:2:3:4:5:6:7',
      '1:2:3:4:5:6:7:8:9',
      '1::2::3',
      'fd00::/129',
      'fd00::g',
      '12345::1',
      '2026-10-09',
      '2027-03-14T08:00:00Z',
      '10.0.0.0/8,',
    ];
    for (const fact of sans) expect(subtitleRuns(fact), fact).toEqual([{ text: fact, family: 'sans' }]);
  });
});

describe('header and padding by depth', () => {
  it('uses the 40 px header up to depth 2 and 32 px below (the canvas is depth 0)', () => {
    expect([1, 2, 3, 4].map((depth) => headerHeightAt(depth, DEFAULT_SIZING))).toEqual([40, 40, 32, 32]);
  });

  it('sets zone titles at 15 px at depth 1 and 13 px deeper', () => {
    expect([1, 2, 3].map((depth) => zoneTitleSizeAt(depth, DEFAULT_SIZING))).toEqual([15, 13, 13]);
  });

  it('pads projects at the top level by 24 and every other zone by 16', () => {
    expect(basePaddingOf({ kind: 'project', depth: 1 }, DEFAULT_SIZING)).toBe(24);
    expect(basePaddingOf({ kind: 'project', depth: 2 }, DEFAULT_SIZING)).toBe(16);
    expect(basePaddingOf({ kind: 'folder', depth: 1 }, DEFAULT_SIZING)).toBe(16);
  });

  it('counts the canvas (the organisation) as depth 0, whether or not the Scene wraps it in an organisation zone', () => {
    // A root folder › folder › project › VPC: depths 1, 2, 3, 4; so 40, 40, 32, 32 px headers and 15, 13, 13,
    // 13 px titles; a product container at depth 3 or deeper takes the nested tint (frontend zoneTintOf).
    const tree = [
      zone('f', 'folder', [zone('g', 'folder', [zone('p', 'project', [zone('v', 'vpc', [card('c')])])])]),
    ];
    for (const children of [tree, [zone(ORGANISATION_ID, 'folder', tree)]]) {
      const { order } = normaliseScene(scene(children));
      sizeNodes(order, context);
      const at = (id: string) => order.find((node) => node.id === id);
      expect(['f', 'g', 'p', 'v'].map((id) => at(id)?.depth)).toEqual([1, 2, 3, 4]);
      expect(['f', 'g', 'p', 'v'].map((id) => at(id)?.headerHeight)).toEqual([40, 40, 32, 32]);
      expect(['f', 'g', 'p', 'v'].map((id) => zoneTitleSizeAt(at(id)?.depth ?? 0, DEFAULT_SIZING))).toEqual([
        15, 13, 13, 13,
      ]);
    }
  });
});

describe('zone title cap', () => {
  const long = 'A pathological folder name that goes on and on '.repeat(6);

  it('counts a title at most zoneTitleMaxWidth towards the header width', () => {
    const cap = DEFAULT_SIZING.zoneTitleMaxWidth;
    const [folder] = normaliseScene(scene([zone('f', 'folder', [card('a')], { label: long })])).order;
    if (folder === undefined) throw new Error('no folder');
    expect(zoneTitleWidth(folder, context)).toBeGreaterThan(cap);
    // Padding, icon, gap, the capped title, padding.
    expect(headerMinWidth(folder, 16, context)).toBe(Math.ceil(16 + 24 + 8 + cap + 16));
  });

  it('counts the capped titles and keeps the full label in the Scene', () => {
    const input = scene([
      zone('f', 'folder', [card('a')], { label: long }),
      zone('g', 'folder', [card('b')]),
    ]);
    const { order } = normaliseScene(input);
    expect(sizeNodes(order, context).cappedTitles).toBe(1);
    expect(order[0]?.label).toBe(long);
  });
});

describe('sibling chips and empty zones', () => {
  it('share the widest of their widths, like the cards of a column; cards keep their own', () => {
    const { order } = normaliseScene(
      scene([
        zone('p', 'project', [
          zone('a', 'project', [], { collapsed: { resources: 1 } }),
          zone('b', 'project', [], { label: 'Shared VPC host (Non-production)', collapsed: { networks: 1 } }),
          zone('e', 'subnet', []),
          card('k'),
        ]),
        zone('q', 'project', [], { collapsed: { resources: 1 } }),
      ]),
    );
    sizeNodes(order, context);
    const width = (id: string): number | undefined => order.find((node) => node.id === id)?.width;
    const widest = chipWidth('Shared VPC host (Non-production)', { networks: 1 }, context).width;
    expect([width('a'), width('b'), width('e')]).toEqual([widest, widest, widest]);
    expect(width('k')).toBe(148);
    // A chip in another container keeps its own width.
    expect(width('q')).toBe(148);
  });
});

describe('headerMinWidth', () => {
  const nodes = normaliseScene(
    scene([
      zone('f', 'folder', [card('a')], {
        label: 'Platform',
        subtitle: 'folder 20000000001',
        badges: ['1 hidden'],
      }),
      zone('p', 'project', [card('b')], {
        label: 'Retail web (prod)',
        subtitle: 'demo-web-1',
        badges: ['x', 'yy'],
      }),
      zone('v', 'vpc', [card('c')], { label: 'vpc' }),
    ]),
  ).order;
  const node = (id: string) => {
    const found = nodes.find((candidate) => candidate.id === id);
    if (found === undefined) throw new Error(id);
    return found;
  };
  // The display name in Roboto 500, then the separator and the subtitle at 400, addresses in Roboto Mono.
  const title = (label: string, subtitle: string | undefined, size: number): number =>
    measureText(label, TEXT_WEIGHTS.zoneTitle, size) +
    (subtitle === undefined
      ? 0
      : subtitleRuns(`${ZONE_TITLE_SEPARATOR}${subtitle}`).reduce(
          (sum, run) => sum + measureText(run.text, TEXT_WEIGHTS.zoneTitleId, size, { family: run.family }),
          0,
        ));
  const pill = (text: string): number => measureText(text, 400, 10.5) + 12;

  it('fits a folder title at the left: padding, icon, title, badges, padding', () => {
    const expected = 2 * 16 + 24 + 8 + title('Platform', 'folder 20000000001', 15) + 12 + pill('1 hidden');
    expect(headerMinWidth(node('f'), 16, context)).toBe(Math.ceil(expected));
  });

  it('measures an address in a zone subtitle in Roboto Mono', () => {
    const subnet = normaliseScene(
      scene([
        zone('s', 'subnet', [card('a')], { label: 'subnet-a', subtitle: '10.0.0.0/24 · europe-west3' }),
      ]),
    ).order[0];
    if (subnet === undefined) throw new Error('s');
    const expected =
      24 +
      8 +
      measureText('subnet-a', 500, 15) +
      measureText(' · ', 400, 15) +
      measureText('10.0.0.0/24', 400, 15, { family: 'mono' }) +
      measureText(' · europe-west3', 400, 15) +
      32;
    expect(headerMinWidth(subnet, 16, context)).toBe(Math.ceil(expected));
  });

  it('keeps every other title centred: the badge block is reserved on both sides', () => {
    const badges = 12 + pill('x') + 4 + pill('yy');
    const expected = 24 + 8 + title('Retail web (prod)', 'demo-web-1', 15) + 2 * (24 + badges);
    expect(headerMinWidth(node('p'), 24, context)).toBe(Math.ceil(expected));
    expect(headerMinWidth(node('v'), 16, context)).toBe(Math.ceil(24 + 8 + title('vpc', undefined, 15) + 32));
  });
});

describe('sizeNodes', () => {
  it('sizes cards, chips and empty zones completely and gives open zones header, padding and minimum width', () => {
    const { order } = normaliseScene(
      scene([
        zone('p', 'project', [card('long', 'eventarc-europe-west3-orders-handler-614468-sub-400')]),
        zone('chip', 'project', [], { collapsed: { resources: 2 } }),
        zone('empty', 'vpc', [], { label: 'vpc-empty', subtitle: 'VPC network · regional routing' }),
      ]),
    );
    const counts = sizeNodes(order, { ...context, ringOf: (id) => (id === 'p' ? 8 : 0) });
    const byId = new Map(order.map((node) => [node.id, node]));
    // The chip and the empty zone are siblings: both take the wider of their two widths.
    const shared = Math.max(
      chipWidth('chip', { resources: 2 }, context).width,
      cardWidth('vpc-empty', 'VPC network · regional routing', context).width,
    );
    expect(byId.get('chip')).toMatchObject({ width: shared, height: 44, headerHeight: 0, padding: 0 });
    expect(byId.get('empty')).toMatchObject({ width: shared, height: 44 });
    expect(byId.get('long')).toMatchObject({ width: 220, height: 44 });
    expect(byId.get('p')).toMatchObject({ headerHeight: 40, padding: 32 });
    expect(byId.get('p')?.minWidth).toBeGreaterThan(0);
    expect(counts.truncatedLabels).toBe(1);
  });
});
