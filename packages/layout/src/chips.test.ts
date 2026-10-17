// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import { CHIP_COUNT_NAMES, chipCountLine, chipWidth } from './chips.js';
import { DEFAULT_SIZING, TEXT_WEIGHTS } from './constants.js';
import { defaultFontMetrics, measureText } from './metrics.js';

const context = { sizing: DEFAULT_SIZING, metrics: defaultFontMetrics() };
/** Padding, the ⊞ glyph, the gap after it and padding: 10 + 16 + 8 + 10. */
const INSET = 44;

describe('chipCountLine', () => {
  it('lists the counts in a fixed order, singular for one, with the middle dot between them', () => {
    expect(chipCountLine({ resources: 39, networks: 2 })).toBe('2 networks · 39 resources');
    expect(chipCountLine({ subnets: 1, folders: 3, containers: 1 })).toBe(
      '3 folders · 1 subnet · 1 container',
    );
    expect(chipCountLine({ networks: 1, subnets: 2, resources: 1 })).toBe(
      '1 network · 2 subnets · 1 resource',
    );
    expect(chipCountLine({})).toBe('');
  });

  it('has a short form of three letters per kind', () => {
    expect(chipCountLine({ networks: 1, subnets: 17, containers: 6, resources: 33 }, true)).toBe(
      '1 net · 17 sub · 6 ctr · 33 res',
    );
    expect(chipCountLine({ projects: 3, resources: 12 }, true)).toBe('3 prj · 12 res');
    expect(CHIP_COUNT_NAMES.map(([kind]) => kind)).toEqual([
      'folders',
      'projects',
      'networks',
      'subnets',
      'containers',
      'resources',
    ]);
  });
});

describe('chipWidth', () => {
  it('never goes below 148 px', () => {
    expect(chipWidth('web', { resources: 2 }, context)).toEqual({
      width: 148,
      line: '2 resources',
      truncated: false,
    });
  });

  it('grows with the label so long labels that share a prefix stay apart', () => {
    const label = 'Shared VPC host (Production)';
    const title = measureText(label, TEXT_WEIGHTS.cardTitle, 13);
    const { width } = chipWidth(label, { networks: 1 }, context);
    expect(width).toBe(Math.min(220, Math.ceil(INSET + title)));
    expect(width).toBeGreaterThan(148);
  });

  it('keeps the full count line when it fits the widest chip, and sizes the chip for it', () => {
    const counts = { networks: 1, subnets: 1, resources: 3 };
    const full = chipCountLine(counts);
    const line = measureText(full, 400, 10.5);
    expect(line).toBeLessThanOrEqual(220 - INSET);
    expect(chipWidth('p', counts, context)).toEqual({
      width: Math.max(148, Math.ceil(INSET + line)),
      line: full,
      truncated: false,
    });
  });

  it('falls back to the short count line when the full one does not fit the widest chip', () => {
    const counts = {
      folders: 12,
      projects: 140,
      networks: 31,
      subnets: 412,
      containers: 96,
      resources: 4821,
    };
    const result = chipWidth('Workloads', counts, context);
    expect(measureText(chipCountLine(counts), 400, 10.5)).toBeGreaterThan(220 - INSET);
    expect(result.line).toBe(chipCountLine(counts, true));
    expect(result.width).toBeLessThanOrEqual(220);
  });

  it('clamps at 220 px and reports a label that does not fit as truncated', () => {
    expect(chipWidth('k8s1-68430c93-shop-frontend-80-0e7bd03e-backend-service', {}, context)).toMatchObject({
      width: 220,
      truncated: true,
    });
  });
});
