// SPDX-License-Identifier: Apache-2.0
/**
 * Tests that layout constants and routing thresholds match the specification in the layout skill
 * (.agents/skills/gcp-diagram-layout/SKILL.md §3, §4, §5).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ASPECT_TOLERANCE,
  DEFAULT_ROUTING,
  DEFAULT_SIZING,
  ROOT_ASPECT,
  TARGET_ASPECT,
} from '../src/constants.js';
import { NEAR_TIE } from '../src/pack.js';
import { SINGLE_PASS_WEIGHT } from '../src/route.js';

const skillPath = path.resolve(import.meta.dirname, '../../../.agents/skills/gcp-diagram-layout/SKILL.md');
const skillText = readFileSync(skillPath, 'utf8');

function extractSection(heading: string, nextHeading: string): string {
  const start = skillText.indexOf(heading);
  if (start === -1) throw new Error(`Missing heading "${heading}" in layout skill`);
  const end = skillText.indexOf(nextHeading, start);
  return end === -1 ? skillText.slice(start) : skillText.slice(start, end);
}

function extractGroups(regex: RegExp, text: string): (string | undefined)[] {
  const match = regex.exec(text);
  if (!match) throw new Error(`Pattern ${regex.source} did not match`);
  return match.slice(1);
}

const section3 = extractSection('## 3. Sizing constants (scale 1)', '## 4. Packing');
const section4 = extractSection('## 4. Packing', '## 5. Gutters and routing');
const section5 = extractSection('## 5. Gutters and routing', '## 6. Progressive disclosure');

describe('gcp-diagram-layout skill §3 sizing constants', () => {
  it('matches card sizing', () => {
    const [height = '', minWidth = '', maxWidth = '', icon = '', padding = ''] = extractGroups(
      /\| Card \| height (\d+); width (\d+)–(\d+) from metrics; icon (\d+); inner padding (\d+) \|/,
      section3,
    );
    expect(DEFAULT_SIZING.cardHeight).toBe(Number(height));
    expect(DEFAULT_SIZING.cardMinWidth).toBe(Number(minWidth));
    expect(DEFAULT_SIZING.cardMaxWidth).toBe(Number(maxWidth));
    expect(DEFAULT_SIZING.cardIcon).toBe(Number(icon));
    expect(DEFAULT_SIZING.cardPadding).toBe(Number(padding));
  });

  it('matches zone header height and depth thresholds', () => {
    const [height = '', shallowMaxDepth = '', deepHeight = ''] = extractGroups(
      /\| Zone header \| (\d+) \(depth ≤ (\d+)\), (\d+) \(depth ≥ 3\) \|/,
      section3,
    );
    expect(DEFAULT_SIZING.headerHeight).toBe(Number(height));
    expect(DEFAULT_SIZING.shallowHeaderMaxDepth).toBe(Number(shallowMaxDepth));
    expect(DEFAULT_SIZING.deepHeaderHeight).toBe(Number(deepHeight));
  });

  it('matches zone title maximum width', () => {
    const [maxWidth = ''] = extractGroups(
      /\| Zone title \| at most (\d+) px \(3 × the widest card\) counts towards/,
      section3,
    );
    expect(DEFAULT_SIZING.zoneTitleMaxWidth).toBe(Number(maxWidth));
    expect(DEFAULT_SIZING.zoneTitleMaxWidth).toBe(3 * DEFAULT_SIZING.cardMaxWidth);
  });

  it('matches zone padding', () => {
    const [rootPad = '', regularPad = ''] = extractGroups(
      /\| Zone padding \| (\d+) at root projects, (\d+) otherwise \|/,
      section3,
    );
    expect(DEFAULT_SIZING.rootProjectPadding).toBe(Number(rootPad));
    expect(DEFAULT_SIZING.zonePadding).toBe(Number(regularPad));
  });

  it('matches gaps between siblings', () => {
    const [gapH = '', gapV = ''] = extractGroups(
      /\| Gap between siblings \| (\d+) horizontal, (\d+) vertical, plus lane space \|/,
      section3,
    );
    expect(DEFAULT_SIZING.gapHorizontal).toBe(Number(gapH));
    expect(DEFAULT_SIZING.gapVertical).toBe(Number(gapV));
  });

  it('matches gutter lane pitch and base width', () => {
    const [pitch = '', base = ''] = extractGroups(
      /\| Gutter lane pitch \| (\d+) px; gutter base width (\d+) px; width = lanes × \d+ \+ \d+ \|/,
      section3,
    );
    expect(DEFAULT_ROUTING.lanePitch).toBe(Number(pitch));
    expect(DEFAULT_ROUTING.gutterBase).toBe(Number(base));
  });

  it('matches chip sizing', () => {
    const [height = '', minWidth = '', maxWidth = '', glyph = '', glyphGap = ''] = extractGroups(
      /\| Chip \| height (\d+); width (\d+)–(\d+) from its label.+after a (\d+) px ⊞ glyph and an (\d+) px gap/,
      section3,
    );
    expect(DEFAULT_SIZING.chipHeight).toBe(Number(height));
    expect(DEFAULT_SIZING.chipMinWidth).toBe(Number(minWidth));
    expect(DEFAULT_SIZING.chipMaxWidth).toBe(Number(maxWidth));
    expect(DEFAULT_SIZING.chipGlyph).toBe(Number(glyph));
    expect(DEFAULT_SIZING.chipGlyphGap).toBe(Number(glyphGap));
  });

  it('matches arrowhead and elbow radius', () => {
    const [inset = ''] = extractGroups(
      /\| Arrowhead \| 9 × 7, ends (\d+) px inside the target border \|/,
      section3,
    );
    expect(DEFAULT_ROUTING.arrowInset).toBe(Number(inset));

    const [radius = ''] = extractGroups(/\| Elbow radius \| (\d+) \|/, section3);
    expect(DEFAULT_ROUTING.elbowRadius).toBe(Number(radius));
  });

  it('matches zone title font sizes and depth threshold in §3 prose', () => {
    const [titleSize = '', maxDepth = '', deepTitleSize = ''] = extractGroups(
      /zone title size \((\d+) px at depth ≤ (\d+), (\d+) px deeper, style §3\)/,
      section3,
    );
    expect(DEFAULT_SIZING.zoneTitleSize).toBe(Number(titleSize));
    expect(DEFAULT_SIZING.largeTitleMaxDepth).toBe(Number(maxDepth));
    expect(DEFAULT_SIZING.deepZoneTitleSize).toBe(Number(deepTitleSize));
  });
});

describe('gcp-diagram-layout skill §4 packing constants', () => {
  it('matches target aspects and tolerances', () => {
    const [targetAspect = '', rootAspect = ''] = extractGroups(
      /target aspect (\d+(?:\.\d+)?), root (\d+(?:\.\d+)?)/,
      skillText,
    );
    expect(TARGET_ASPECT).toBe(Number(targetAspect));
    expect(ROOT_ASPECT).toBe(Number(rootAspect));

    const [tolerancePct = ''] = extractGroups(/within (\d+) %\s+of the target\s+aspect/, section4);
    expect(ASPECT_TOLERANCE).toBe(Number(tolerancePct) / 100);

    const [tiePct = ''] = extractGroups(
      /within (\d+) %\s+of the smallest frame[\s\S]+?\(`NEAR_TIE`\)/,
      section4,
    );
    expect(NEAR_TIE).toBe(Number(tiePct) / 100);
  });
});

describe('gcp-diagram-layout skill §5 routing costs and thresholds', () => {
  it('matches bend cost, lane cost, hug factor and hug cap', () => {
    const [bendCost = '', laneCost = ''] = extractGroups(
      /cost = length \+ (\d+) per bend \+ (\d+) per lane already assigned in a gutter/,
      section5,
    );
    expect(DEFAULT_ROUTING.bendCost).toBe(Number(bendCost));
    expect(DEFAULT_ROUTING.laneCost).toBe(Number(laneCost));

    const [hugFactor = '', hugCap = ''] = extractGroups(
      /costs (\d+(?:\.\d+)?) × its length but at most (\d+) more than its length over the whole side/,
      section5,
    );
    expect(DEFAULT_ROUTING.hugFactor).toBe(Number(hugFactor));
    expect(DEFAULT_ROUTING.hugCap).toBe(Number(hugCap));

    const [marginFactor = ''] = extractGroups(/and one in the canvas margin (\d+) ×/, section5);
    expect(DEFAULT_ROUTING.marginFactor).toBe(Number(marginFactor));
  });

  it('matches widening rounds and late-round threshold', () => {
    const [maxRoundsWord = '', , lateHolders = ''] = extractGroups(
      /up to (three|\d+) rounds \((two|\d+) above (\d+) lane holders/,
      section5,
    );
    const wordToNumber: Record<string, number> = { three: 3, two: 2 };
    expect(DEFAULT_ROUTING.wideningRounds).toBe(wordToNumber[maxRoundsWord] ?? Number(maxRoundsWord));
    expect(DEFAULT_ROUTING.lateRoundsUpTo).toBe(Number(lateHolders));
  });

  it('matches single pass work threshold and weight', () => {
    const [workStr = '', weightStr = ''] = extractGroups(
      /reaches (\d+ \d+) the rest of the pass is searched weighted\s+\(each route at most (\d+(?:\.\d+)?) × the cheapest\)/,
      section5,
    );
    const singlePassWork = Number(workStr.replace(/\s+/g, ''));
    expect(DEFAULT_ROUTING.singlePassWork).toBe(singlePassWork);
    expect(SINGLE_PASS_WEIGHT).toBe(Number(weightStr));
  });

  it('matches one round work threshold', () => {
    const [workStr = ''] = extractGroups(/above (\d+ \d+) one widening round at most/, section5);
    const oneRoundWork = Number(workStr.replace(/\s+/g, ''));
    expect(DEFAULT_ROUTING.oneRoundWork).toBe(oneRoundWork);
  });

  it('matches port spacing and hub bundle minimum', () => {
    const [portSpacing = ''] = extractGroups(/port slot spaced (\d+) px along\s+that side/, section5);
    expect(DEFAULT_ROUTING.portSpacing).toBe(Number(portSpacing));

    const [bundleMin = ''] = extractGroups(/bundled from (\d+)\s+\(from 2 on a\s+crowded side\)/, section5);
    expect(DEFAULT_ROUTING.bundleMin).toBe(Number(bundleMin));
  });
});
