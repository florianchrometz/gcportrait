// SPDX-License-Identifier: Apache-2.0
/**
 * The diagram palettes against the style skill (gcp-diagram-style §2, §9, §10), in both themes:
 *
 * 1. the token table (tokens.ts) holds the skill's §2 values, except the departures it lists
 *    (`SKILL_DEPARTURES`, none at present), and tokens.css defines the same values;
 * 2. each departure is still needed: with the §2 value put back, a §10 pair fails (so a departure goes as soon
 *    as the skill adopts a value that passes); and each muted grey stroke still is: the fainter grey it could take
 *    instead fails a §10 pair (`FAINTER`);
 * 3. every §10 pair reaches its threshold. The only pairs allowed below it are the skill's own documented
 *    exemption, the VPC and subnet outlines ("decorative stroke"), and only while the compensating checks the
 *    skill names pass (the title text on the fill, the card stroke inside it).
 *
 * The tokens are the renderer's, so this test lives next to them in the frontend.
 */
import { describe, expect, it } from 'vitest';

import skill from '@agent-skills/gcp-diagram-style/SKILL.md?raw';
import tokensCss from './tokens.css?raw';
import { blendOver, contrastRatio, readableOn, TEXT_CONTRAST } from './contrast';
import { GHOST_OPACITY, OVERLAY_OPACITY } from './styles';
import {
  cssVariables,
  PALETTES,
  SKILL_DEPARTURES,
  ZONE_TINTS,
  type DiagramPalette,
  type DiagramTheme,
  type SkillDeparture,
  type ZoneTint,
} from './tokens';

const THEMES: readonly DiagramTheme[] = ['light', 'dark'];
const NON_TEXT = 3;
/** The skill's documented exemption (§10): these outlines may stay below 3 : 1. */
const DECORATIVE: readonly ZoneTint[] = ['vpc', 'subnet'];

/**
 * The fainter greys the container outlines and the dim edge could take instead of each theme's `muted` (`skill`
 * here, `value` the one §2 holds): every one of them fails a §10 pair, which is why §2 sets `muted`.
 */
const FAINTER: readonly SkillDeparture[] = [
  {
    theme: 'light',
    token: 'zone.folder',
    part: 'stroke',
    skill: '#9AA0A6',
    value: '#5F6368',
    fails: '2.37 on its fill',
  },
  {
    theme: 'light',
    token: 'zone.nested',
    part: 'stroke',
    skill: '#9AA0A6',
    value: '#5F6368',
    fails: '2.03 on its fill',
  },
  {
    theme: 'light',
    token: 'zone.other',
    part: 'stroke',
    skill: '#9AA0A6',
    value: '#5F6368',
    fails: '2.50 on its fill',
  },
  {
    theme: 'light',
    token: 'zone.region',
    part: 'stroke',
    skill: '#DADCE0',
    value: '#5F6368',
    fails: '1.25 on a project',
  },
  { theme: 'light', token: 'edge.dim', skill: '#BDC1C6', value: '#5F6368', fails: '1.81 on the canvas' },
  {
    theme: 'dark',
    token: 'zone.folder',
    part: 'stroke',
    skill: '#5F6368',
    value: '#9AA0A6',
    fails: '2.34 on its fill',
  },
  {
    theme: 'dark',
    token: 'zone.nested',
    part: 'stroke',
    skill: '#5F6368',
    value: '#9AA0A6',
    fails: '1.78 on its fill',
  },
  {
    theme: 'dark',
    token: 'zone.other',
    part: 'stroke',
    skill: '#5F6368',
    value: '#9AA0A6',
    fails: '2.15 on its fill',
  },
  {
    theme: 'dark',
    token: 'zone.region',
    part: 'stroke',
    skill: '#5F6368',
    value: '#9AA0A6',
    fails: '1.91 on a project',
  },
  { theme: 'dark', token: 'edge.dim', skill: '#5F6368', value: '#9AA0A6', fails: '2.72 on the canvas' },
];

/** The rows of the skill's §2 table for a theme: token names → the colours in the row's last cell. */
function skillTable(theme: DiagramTheme): Map<string, string[]> {
  const start = skill.indexOf('## 2. Palette');
  const end = skill.indexOf('## 3.');
  const section = skill.slice(start, end);
  const lightAt = section.indexOf('### Light');
  const darkAt = section.indexOf('### Dark');
  const part = theme === 'light' ? section.slice(lightAt, darkAt) : section.slice(darkAt);
  const rows = new Map<string, string[]>();
  for (const line of part.split('\n')) {
    if (!line.startsWith('| `')) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    const names = [...(cells[1] ?? '').matchAll(/`([A-Za-z.]+)`/g)].map((match) => match[1] ?? '');
    const colours = [...(cells[cells.length - 2] ?? '').matchAll(/#[0-9A-Fa-f]{6}/g)].map((match) =>
      match[0].toUpperCase(),
    );
    if (names.length > 1) names.forEach((name, index) => rows.set(name, [colours[index] ?? '']));
    else if (names[0] !== undefined) rows.set(names[0], colours);
  }
  return rows;
}

/** What the palette holds for a skill token name (a zone: fill and stroke, or the stroke alone without fill). */
function paletteValues(palette: DiagramPalette, token: string): string[] {
  const zone = /^zone\.(\w+)$/.exec(token)?.[1];
  if (zone !== undefined) {
    const paint = palette.zone[zone as ZoneTint];
    return paint.fill === 'none' ? [paint.stroke] : [paint.fill, paint.stroke];
  }
  const simple: Record<string, string[]> = {
    canvas: [palette.canvas],
    ink: [palette.ink],
    muted: [palette.muted],
    border: [palette.border],
    surface: [palette.surface],
    card: [palette.card.fill, palette.card.stroke],
    edge: [palette.edge],
    'edge.dim': [palette.edgeDim],
    'accent.select': [palette.accentSelect],
    'accent.path': [palette.accentPath],
    'accent.peer': [palette.accentPeer],
    'accent.removed': [palette.accentRemoved],
    'chip.text': [palette.chipText],
    mutedOnTint: [palette.mutedOnTint],
    pathCasing: [palette.pathCasing],
  };
  const values = simple[token];
  if (values === undefined) throw new Error(`the palette has no token ${token}`);
  return values;
}

/** The palette with one departure undone: the skill's §2 value put back. */
function withSkillValue(palette: DiagramPalette, departure: SkillDeparture): DiagramPalette {
  const zone = /^zone\.(\w+)$/.exec(departure.token)?.[1] as ZoneTint | undefined;
  if (zone !== undefined && departure.part === 'stroke') {
    return {
      ...palette,
      zone: { ...palette.zone, [zone]: { ...palette.zone[zone], stroke: departure.skill } },
    };
  }
  if (departure.token === 'edge.dim') return { ...palette, edgeDim: departure.skill };
  throw new Error(`no way to undo the departure of ${departure.token}`);
}

/** The `--dg-*` custom properties a theme's block in tokens.css defines. */
function cssBlock(theme: DiagramTheme): Map<string, string> {
  const selector = theme === 'light' ? ":root[data-theme='light'] {" : ":root[data-theme='dark'] {";
  const start = tokensCss.indexOf(selector);
  const body = tokensCss.slice(start, tokensCss.indexOf('}', start));
  const values = new Map<string, string>();
  for (const match of body.matchAll(/(--dg-[a-z-]+):\s*([^;]+);/g))
    values.set(match[1] ?? '', (match[2] ?? '').trim());
  return values;
}

type Ground = 'canvas' | 'surface' | ZoneTint;

/**
 * What a zone of each tint can sit on: its parent's background (a region zone has no fill and shows its own
 * parent's), and the legend panel (`surface`), where every tint present has a sample swatch.
 */
const PARENTS: Readonly<Record<ZoneTint, readonly Ground[]>> = {
  folder: ['canvas', 'folder', 'surface'],
  project: ['canvas', 'folder', 'other', 'surface'],
  vpc: ['project', 'region', 'surface'],
  subnet: ['vpc', 'surface'],
  region: ['canvas', 'folder', 'project', 'other', 'surface'],
  other: ['canvas', 'folder', 'project', 'vpc', 'subnet', 'region', 'other', 'surface'],
  nested: ['project', 'vpc', 'subnet', 'region', 'other', 'nested', 'surface'],
};

/** The colours behind a ground: a fill, or for a region (no fill) whatever it sits on. */
function backgroundsOf(palette: DiagramPalette, ground: Ground): string[] {
  if (ground === 'canvas') return [palette.canvas];
  if (ground === 'surface') return [palette.surface];
  const fill = palette.zone[ground].fill;
  if (fill !== 'none') return [fill];
  return PARENTS[ground]
    .filter((parent) => parent !== ground)
    .flatMap((parent) => backgroundsOf(palette, parent));
}

/** Every fill an edge, a card or a chip can sit on: the canvas and each tint. */
function fills(palette: DiagramPalette): ReadonlyArray<readonly [string, string]> {
  return [
    ['canvas', palette.canvas],
    ...ZONE_TINTS.flatMap((tint) => {
      const fill = palette.zone[tint].fill;
      return fill === 'none' ? [] : [[tint, fill] as const];
    }),
  ];
}

/** Secondary text on a background: `muted`, or `mutedOnTint` where `muted` is below 4.5 : 1 (the renderer's rule). */
function secondaryOn(palette: DiagramPalette, background: string): string {
  return readableOn(background, [palette.muted, palette.mutedOnTint]);
}

interface Pair {
  readonly what: string;
  /** The skill tokens the pair checks (to find what a departure's §2 value breaks). */
  readonly tokens: readonly string[];
  readonly foreground: string;
  readonly background: string;
  readonly minimum: number;
  /** The tint of a VPC or subnet outline pair: the skill's documented decorative-stroke exemption. */
  readonly decorative?: ZoneTint;
}

/**
 * The fills a ghost can lie on: the canvas and every tint drawn (a card's ghost), and each tint on what it
 * can sit on (a zone's ghost: its tint at 50 % over that, a region's being what it lies on), each named.
 */
function ghostGrounds(palette: DiagramPalette): Array<{ readonly name: string; readonly body: string }> {
  const out: Array<{ readonly name: string; readonly body: string }> = [];
  for (const [name, fill] of fills(palette))
    out.push({ name: `a card's ghost on ${name}`, body: blendOver(palette.card.fill, GHOST_OPACITY, fill) });
  for (const tint of ZONE_TINTS) {
    for (const ground of PARENTS[tint]) {
      for (const behind of backgroundsOf(palette, ground)) {
        const own = palette.zone[tint].fill;
        const body = blendOver(own === 'none' ? behind : own, GHOST_OPACITY, behind);
        out.push({ name: `a ${tint} ghost on ${ground} (${behind})`, body });
        // A card's ghost inside it (what a removed project held).
        out.push({
          name: `a card's ghost in a ${tint} ghost on ${ground} (${behind})`,
          body: blendOver(palette.card.fill, GHOST_OPACITY, body),
        });
      }
    }
  }
  return out;
}

/**
 * The timeline markers (skill §6): the added outline in `accent.peer` between canvas gaps; the removed ghost's
 * dashed outline in `accent.removed` at full strength on a canvas band; the changed dot in `accent.path` on a
 * `pathCasing` disc, which itself stands out from every fill (and card) the amber alone does not; the ghost's label
 * and line in the readable grey of its body (its fill at 50 % over what it lies on).
 */
function timelineMarkerPairs(palette: DiagramPalette, pairs: Pair[]): void {
  const graphic = (what: string, tokens: string[], foreground: string, background: string): void => {
    pairs.push({ what, tokens, foreground, background, minimum: NON_TEXT });
  };
  graphic('added outline on its canvas gap', ['accent.peer'], palette.accentPeer, palette.canvas);
  graphic(
    'removed ghost outline on its canvas band',
    ['accent.removed'],
    palette.accentRemoved,
    palette.canvas,
  );
  graphic('changed dot on its pathCasing disc', ['accent.path'], palette.accentPath, palette.pathCasing);
  for (const [name, fill] of [...fills(palette), ['card', palette.card.fill] as const]) {
    if (contrastRatio(palette.accentPath, fill) < NON_TEXT)
      graphic(`changed dot's disc over ${name}`, ['accent.path'], palette.pathCasing, fill);
  }
  for (const { name, body } of ghostGrounds(palette)) {
    pairs.push({
      what: `ghost label on ${name}`,
      tokens: ['muted', 'mutedOnTint'],
      foreground: secondaryOn(palette, body),
      background: body,
      minimum: TEXT_CONTRAST,
    });
  }
}

/** Every §10 pair of a palette, as the renderer draws it. */
function contrastPairs(palette: DiagramPalette): Pair[] {
  const pairs: Pair[] = [];
  const text = (what: string, tokens: string[], foreground: string, background: string): void => {
    pairs.push({ what, tokens, foreground, background, minimum: TEXT_CONTRAST });
  };
  const graphic = (what: string, tokens: string[], foreground: string, background: string): void => {
    pairs.push({ what, tokens, foreground, background, minimum: NON_TEXT });
  };

  // 1.4.3: text on its background.
  text('card title', ['ink', 'card'], palette.ink, palette.card.fill);
  text('card subtitle', ['muted', 'card'], secondaryOn(palette, palette.card.fill), palette.card.fill);
  text('legend text', ['ink', 'surface'], palette.ink, palette.surface);
  text('badge text', ['muted', 'surface'], palette.muted, palette.surface);
  text('title block', ['ink', 'canvas'], palette.ink, palette.canvas);
  text('title block, muted lines', ['muted', 'canvas'], palette.muted, palette.canvas);
  for (const tint of ZONE_TINTS) {
    for (const background of backgroundsOf(palette, tint)) {
      const on = `${tint} (${background})`;
      text(`zone title on ${on}`, ['ink', `zone.${tint}`], palette.ink, background);
      text(`zone id on ${on}`, ['muted', `zone.${tint}`], secondaryOn(palette, background), background);
      text(`chip text on ${on}`, ['chip.text', `zone.${tint}`], palette.chipText, background);
      text(`card-sized zone subtitle on ${on}`, ['muted'], secondaryOn(palette, background), background);
    }
  }

  // 1.4.11: zone outlines against their own fill and every parent background.
  for (const tint of ZONE_TINTS) {
    const stroke = palette.zone[tint].stroke;
    const grounds: Ground[] = [tint, ...PARENTS[tint]];
    for (const ground of grounds) {
      for (const background of backgroundsOf(palette, ground)) {
        pairs.push({
          what: `${tint} outline on ${ground} (${background})`,
          tokens: [`zone.${tint}`],
          foreground: stroke,
          background,
          minimum: NON_TEXT,
          ...(DECORATIVE.includes(tint) ? { decorative: tint } : {}),
        });
      }
    }
  }

  // 1.4.11: card outlines, edges (plain and dim), the chip's glyph against every fill they meet.
  graphic('card outline on the card', ['card'], palette.card.stroke, palette.card.fill);
  for (const [name, fill] of fills(palette)) {
    graphic(`card outline on ${name}`, ['card'], palette.card.stroke, fill);
    graphic(`edge over ${name}`, ['edge'], palette.edge, fill);
    graphic(`dim edge over ${name}`, ['edge.dim'], palette.edgeDim, fill);
    graphic(`chip glyph on ${name}`, ['chip.text'], palette.chipText, fill);
  }
  graphic('edge beside a card', ['edge'], palette.edge, palette.card.fill);
  graphic('dim edge beside a card', ['edge.dim'], palette.edgeDim, palette.card.fill);

  // 1.4.11 and 2.4.13: accents and the focus ring sit between gaps of a colour they contrast with (skill §9's
  // focus-ring construction). Selection and focus: canvas gaps. The ancestor path and the `secures` overlay
  // (accent.path at 50 % over a canvas-coloured core): the pathCasing band. Peers and the timeline markers below.
  graphic('selection ring on its canvas gap', ['accent.select'], palette.accentSelect, palette.canvas);
  graphic('focus ring on its canvas gap', ['canvas'], palette.focus, palette.canvas);
  // And against every fill the ring can be drawn over, so its pixels differ by 3 : 1 between the focused and
  // the unfocused drawing (2.4.13's measure) wherever it lies, not only beside its gaps.
  for (const [name, fill] of fills(palette))
    graphic(`focus ring drawn over ${name}`, ['canvas'], palette.focus, fill);
  graphic('ancestor path on its casing', ['accent.path'], palette.accentPath, palette.pathCasing);
  graphic(
    'secures overlay (50 %) on its casing',
    ['accent.path'],
    blendOver(palette.accentPath, OVERLAY_OPACITY, palette.canvas),
    palette.pathCasing,
  );
  graphic('peer accent on a canvas gap', ['accent.peer'], palette.accentPeer, palette.canvas);
  timelineMarkerPairs(palette, pairs);

  // The selection trace (skill §6): traced lines in accent.select on their canvas casing, the reach rings
  // on their canvas gap, the path to the root in accent.path on its pathCasing band, which itself stands out
  // from every fill it crosses; the console action's text and outline on its canvas pill.
  graphic('traced line on its canvas casing', ['accent.select'], palette.accentSelect, palette.canvas);
  graphic('reach ring on its canvas gap', ['accent.select'], palette.accentSelect, palette.canvas);
  // Where the amber alone is below 3 : 1 on a fill (the light theme), the casing is what makes the path
  // visible there, so it must stand out from that fill itself; in dark the casing is a plain canvas gap.
  for (const [name, fill] of [...fills(palette), ['legend', palette.surface] as const]) {
    if (contrastRatio(palette.accentPath, fill) < NON_TEXT)
      graphic(`path casing over ${name}`, ['accent.path'], palette.pathCasing, fill);
  }
  text('console action text on its pill', ['accent.select', 'canvas'], palette.accentSelect, palette.canvas);
  // Keyboard focus fills the pill in the focus colour, with its label and glyph in canvas.
  text('console action text on its focused pill', ['canvas'], palette.canvas, palette.focus);
  graphic('focused console action on a card', ['canvas'], palette.focus, palette.card.fill);
  // The focused console action and an open zone's focused collapse plate sit on a canvas-coloured rim
  // (diagram.css, disclosure/disclosure.css), as the focus ring sits between canvas gaps (the light chrome primary
  // they used before reached 2.62 on the project tint; the canvas's focus colour reaches 3.78); the plate's glyph
  // turns canvas.
  graphic(
    'focused console action or collapse plate on its canvas rim',
    ['canvas'],
    palette.focus,
    palette.canvas,
  );
  graphic('collapse glyph on its focused plate', ['canvas'], palette.canvas, palette.focus);
  return pairs;
}

/**
 * The trace colours against every zone fill directly: where one is below 3 : 1 it must never touch that
 * fill, which the casing or gap of its construction guarantees. These are the fills that need it.
 */
function fillsNeedingTheConstruction(palette: DiagramPalette): string[] {
  const out: string[] = [];
  for (const [name, fill] of fills(palette)) {
    for (const [accent, colour] of [
      ['accent.select', palette.accentSelect],
      ['accent.path', palette.accentPath],
    ] as const) {
      if (contrastRatio(colour, fill) < NON_TEXT) out.push(`${accent} on ${name}`);
    }
  }
  return out;
}

function ratioOf(pair: Pair): number {
  return contrastRatio(pair.foreground, pair.background);
}

/** The pairs below their threshold, the documented decorative strokes left out. */
function failures(palette: DiagramPalette): Pair[] {
  return contrastPairs(palette).filter(
    (pair) => pair.decorative === undefined && ratioOf(pair) < pair.minimum,
  );
}

function describePairs(pairs: readonly Pair[]): string[] {
  return pairs.map(
    (pair) => `${pair.what}: ${pair.foreground} on ${pair.background} = ${ratioOf(pair).toFixed(2)} : 1`,
  );
}

describe('the token table is the style skill §2, with the listed departures', () => {
  it.each(THEMES)('%s: every token of the skill table, value for value or as departed', (theme) => {
    const table = skillTable(theme);
    expect(table.size).toBeGreaterThanOrEqual(theme === 'light' ? 19 : 14);
    for (const [token, colours] of table) {
      const expected = [...colours];
      for (const departure of SKILL_DEPARTURES) {
        if (departure.theme !== theme || departure.token !== token) continue;
        const index = departure.part === 'stroke' ? expected.length - 1 : 0;
        // The departure records the skill's real value.
        expect(expected[index], `${token}: the skill's value`).toBe(departure.skill);
        expected[index] = departure.value;
      }
      expect(paletteValues(PALETTES[theme], token), token).toEqual(expected);
    }
  });

  it('every fill is the skill value: departures are strokes and the dim edge only', () => {
    for (const departure of SKILL_DEPARTURES) {
      expect(departure.part === 'stroke' || departure.token === 'edge.dim', departure.token).toBe(true);
    }
  });

  it('departs only to colours the palette already has (the muted grey of each theme)', () => {
    for (const departure of SKILL_DEPARTURES) {
      expect(departure.value, `${departure.theme} ${departure.token}`).toBe(PALETTES[departure.theme].muted);
    }
    expect(PALETTES.light.mutedOnTint).toBe(PALETTES.light.chipText);
    expect(PALETTES.dark.mutedOnTint).toBe(PALETTES.dark.card.stroke);
    // The light casing is muted (ink read as hazard tape), the dark one the canvas, as the rings' gaps.
    expect(PALETTES.light.pathCasing).toBe(PALETTES.light.muted);
    expect(PALETTES.dark.pathCasing).toBe(PALETTES.dark.canvas);
  });

  it('lists no departure that is no longer needed: with the §2 value put back, a §10 pair fails', () => {
    for (const departure of SKILL_DEPARTURES) {
      const broken = failures(withSkillValue(PALETTES[departure.theme], departure)).filter((pair) =>
        pair.tokens.includes(departure.token),
      );
      expect(describePairs(broken).length, departure.fails).toBeGreaterThan(0);
    }
  });

  it.each(FAINTER.map((fainter) => [fainter.theme, fainter.token, fainter] as const))(
    '%s %s: the value §2 holds is in the table, and a fainter grey fails a §10 pair',
    (theme, token, fainter) => {
      const values = paletteValues(PALETTES[theme], token);
      expect(values[values.length - 1]).toBe(fainter.value);
      expect(skillTable(theme).get(token)?.at(-1)).toBe(fainter.value);
      const broken = failures(withSkillValue(PALETTES[theme], fainter)).filter((pair) =>
        pair.tokens.includes(token),
      );
      expect(describePairs(broken).length, fainter.fails).toBeGreaterThan(0);
    },
  );

  it('derives the values the dark table leaves out from palette colours', () => {
    const dark = PALETTES.dark;
    const table = skillTable('dark');
    expect(table.has('edge') || table.has('chip.text')).toBe(false);
    expect(dark.edge).toBe(dark.ink); // the dark `ink` row: "text, strokes, edges"
    expect(dark.chipText).toBe(dark.ink);
    // The region outline is each theme's muted grey (the theme's border would fail).
    expect(table.get('zone.region')).toEqual([dark.muted]);
    expect(skillTable('light').get('zone.region')).toEqual([PALETTES.light.muted]);
    // The renderer's two tokens beyond the base palette are in §2.
    expect(table.get('mutedOnTint')).toEqual([dark.mutedOnTint]);
    expect(skillTable('light').get('pathCasing')).toEqual([PALETTES.light.pathCasing]);
  });

  it('uses §9’s canvas focus colour: the dark chrome primary, and in light the darker blue §9 names', () => {
    const chrome = /Light: `primary (#[0-9A-F]{6})`[\s\S]*?Dark: `primary (#[0-9A-F]{6})`/.exec(skill);
    expect(PALETTES.dark.focus).toBe(chrome?.[2]);
    expect(PALETTES.light.focus).toBe(/light `focus (#[0-9A-F]{6})`/.exec(skill)?.[1]);
    // The light chrome primary is below 3 : 1 on the project tint; the canvas's focus colour is not, anywhere.
    expect(contrastRatio(chrome?.[1] ?? '', PALETTES.light.zone.project.fill)).toBeLessThan(NON_TEXT);
  });

  it.each(THEMES)('%s: tokens.css defines the same values as tokens.ts', (theme) => {
    const css = cssBlock(theme);
    const expected = cssVariables(PALETTES[theme]);
    expect([...css.keys()].sort()).toEqual(expected.map(([name]) => name).sort());
    for (const [name, value] of expected)
      expect(css.get(name)?.toUpperCase(), name).toBe(value.toUpperCase());
  });
});

describe.each(THEMES)('WCAG 2.2 contrast, %s theme (skill §10)', (theme) => {
  const palette = PALETTES[theme];
  const pairs = contrastPairs(palette);

  it('covers text, zone outlines, cards, edges, accents and the focus ring', () => {
    expect(pairs.length).toBeGreaterThan(100);
    for (const tint of ZONE_TINTS) {
      expect(pairs.some((pair) => pair.tokens.includes(`zone.${tint}`) && pair.minimum === NON_TEXT)).toBe(
        true,
      );
    }
  });

  it('every pair reaches its threshold (4.5 : 1 text, 3 : 1 graphics), the decorative strokes aside', () => {
    expect(describePairs(failures(palette))).toEqual([]);
  });

  it('only the VPC and subnet outlines may be decorative, and only with the compensating checks', () => {
    const decorative = pairs.filter((pair) => pair.decorative !== undefined && ratioOf(pair) < pair.minimum);
    for (const pair of decorative) {
      const tint = pair.decorative ?? 'vpc';
      expect(DECORATIVE).toContain(tint);
      for (const fill of backgroundsOf(palette, tint)) {
        // The skill's compensating checks: the zone's title on its fill, the cards' outline inside it.
        expect(contrastRatio(palette.ink, fill), `${tint} title`).toBeGreaterThanOrEqual(TEXT_CONTRAST);
        expect(contrastRatio(palette.card.stroke, fill), `card in ${tint}`).toBeGreaterThanOrEqual(NON_TEXT);
      }
    }
    // Measured: in light both are below 3 : 1 (1.22 and 1.11 on their fills); in dark both pass. Asserted as a
    // subset, so a later stroke that passes is welcome.
    const tints = new Set(decorative.map((pair) => pair.decorative));
    for (const tint of tints) expect(DECORATIVE).toContain(tint);
  });

  it('draws every trace colour with a casing or gap wherever a fill alone would not reach 3 : 1', () => {
    const needing = fillsNeedingTheConstruction(palette);
    // Measured: light accent.select is below 3 : 1 only on the project tint (2.62); the light amber on almost
    // every light fill; in dark both reach 3 : 1 on every fill (casing and gaps kept for one look).
    if (theme === 'light') {
      expect(needing).toContain('accent.select on project');
      expect(needing.filter((entry) => entry.startsWith('accent.select'))).toEqual([
        'accent.select on project',
      ]);
      expect(needing.length).toBeGreaterThan(1);
    } else {
      expect(needing).toEqual([]);
    }
    // Each construction's own pair passes (asserted above with every pair): the accent on its casing or gap.
    expect(contrastRatio(palette.accentSelect, palette.canvas)).toBeGreaterThanOrEqual(NON_TEXT);
    expect(contrastRatio(palette.accentPath, palette.pathCasing)).toBeGreaterThanOrEqual(NON_TEXT);
  });

  it('tells the dark subnet outline from the path-to-root accent (so it does not look highlighted)', () => {
    const subnet = palette.zone.subnet.stroke;
    expect(subnet).not.toBe(palette.accentPath);
    if (theme === 'dark') {
      expect(subnet).toBe('#B39B4C');
      expect(contrastRatio(subnet, palette.accentPath)).toBeGreaterThan(1.9);
    }
  });

  it('sets secondary text in muted where it is readable, else in mutedOnTint', () => {
    // Measured with the §2 tints: mutedOnTint is used on the light project tint (muted 3.52 : 1) and on the dark
    // project and nested tints (4.38 and 4.07); a region zone shows the tint it sits on.
    for (const tint of ZONE_TINTS) {
      for (const fill of backgroundsOf(palette, tint)) {
        const readable = contrastRatio(palette.muted, fill) >= TEXT_CONTRAST;
        expect(secondaryOn(palette, fill), `${tint} (${fill})`).toBe(
          readable ? palette.muted : palette.mutedOnTint,
        );
      }
    }
  });
});

describe.each(THEMES)('timeline markers on every fill, %s theme (skill §6, §10)', (theme) => {
  const palette = PALETTES[theme];
  const pairs = contrastPairs(palette);
  const markers = pairs.filter(
    (pair) =>
      /^(added outline|removed ghost outline|changed dot|ghost label)/.test(pair.what) &&
      ratioOf(pair) < pair.minimum,
  );

  it('every marker pair reaches its threshold: the accents on their gaps, the dot’s disc, the ghosts’ labels', () => {
    expect(describePairs(markers)).toEqual([]);
    expect(pairs.filter((pair) => pair.what.startsWith('ghost label')).length).toBeGreaterThan(40);
  });

  it('draws each marker with its gap, band or disc wherever its accent alone is below 3 : 1 on a fill', () => {
    const needing: string[] = [];
    for (const [name, fill] of [...fills(palette), ['card', palette.card.fill] as const]) {
      for (const [accent, colour] of [
        ['accent.peer', palette.accentPeer],
        ['accent.removed', palette.accentRemoved],
        ['accent.path', palette.accentPath],
      ] as const) {
        if (contrastRatio(colour, fill) < NON_TEXT) needing.push(`${accent} on ${name}`);
      }
    }
    // Measured: in light the green reaches 2.92 : 1 and the red 2.78 on the project tint (5.02 and 4.77 on their
    // canvas gap and band), the amber 1.13–1.93 on every fill (3.13 on its disc, which reaches 3.52 on the project
    // tint at worst); in dark every accent reaches 3 : 1 on every fill (4.50 the red on the nested tint at worst).
    if (theme === 'light') {
      expect(needing.filter((entry) => !entry.startsWith('accent.path'))).toEqual([
        'accent.peer on project',
        'accent.removed on project',
      ]);
      expect(needing.filter((entry) => entry.startsWith('accent.path')).length).toBe(
        fills(palette).length + 1,
      );
    } else {
      expect(needing).toEqual([]);
    }
  });

  it('keeps the ghost’s outline at full strength: at 50 % the red would be below 3 : 1 on the canvas', () => {
    expect(
      contrastRatio(blendOver(palette.accentRemoved, GHOST_OPACITY, palette.canvas), palette.canvas),
    ).toBeLessThan(NON_TEXT);
    expect(contrastRatio(palette.accentRemoved, palette.canvas)).toBeGreaterThanOrEqual(NON_TEXT);
  });
});
