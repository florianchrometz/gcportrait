// SPDX-License-Identifier: Apache-2.0
/**
 * The timeline markers' words (words.ts): the day compared with at the viewer's offset, "since" or
 * "compared with", an extra tick by its label, and the wording of the legend rows, the accessible names, the ghosts
 * and the description.
 */
import { describe, expect, it } from 'vitest';

import {
  comparesForward,
  countsText,
  dayLabel,
  dayName,
  descriptionText,
  ghostText,
  markerLabel,
  nameSuffix,
  sincePhrase,
} from './words';

const SINCE = { tick: '2026-09-07', readTime: '2026-09-07T00:00:00Z' } as const;

describe('the markers’ words', () => {
  it('names the day compared with at the viewer’s offset, as the title block names a read time', () => {
    expect(dayLabel(SINCE, 0)).toBe('2026-09-07');
    expect(dayLabel(SINCE, 120)).toBe('2026-09-07');
    expect(dayLabel(SINCE, -300)).toBe('2026-09-06');
    expect(sincePhrase(SINCE, true, 0)).toBe('since 2026-09-07');
    expect(sincePhrase(SINCE, false, 0)).toBe('compared with 2026-09-07');
    expect(comparesForward(SINCE, '2026-09-08T00:00:00Z')).toBe(true);
    expect(comparesForward(SINCE, '2026-09-06T00:00:00Z')).toBe(false);
  });

  it('names an extra tick compared with by its label, not its date', () => {
    const extra = {
      tick: '2026-10-05T14:30:00Z',
      readTime: '2026-10-05T14:30:00Z',
      label: 'export 2026-10-05 14:30',
    };
    expect(sincePhrase(extra, true, 0)).toBe('since export 2026-10-05 14:30');
    expect(sincePhrase(extra, false, 120)).toBe('compared with export 2026-10-05 14:30');
    expect(dayName(extra, 0)).toBe('export 2026-10-05 14:30');
    expect(dayName({ readTime: extra.readTime }, 0)).toBe('2026-10-05');
  });

  it('words the legend rows, the names, the ghosts and the description', () => {
    expect(markerLabel('added', 'since 2026-09-07')).toBe('added since 2026-09-07');
    expect(countsText({ added: 2, removed: 0, changed: 1 })).toBe('2 added, 1 changed');
    expect(countsText({ added: 0, removed: 0, changed: 0 })).toBe('no changes');
    expect(nameSuffix('added', undefined, 'since 2026-09-07')).toBe(', added since 2026-09-07');
    expect(nameSuffix(undefined, { added: 0, removed: 2, changed: 1 }, 'since 2026-09-07')).toBe(
      ', changes inside since 2026-09-07: 2 removed, 1 changed',
    );
    expect(nameSuffix(undefined, undefined, 'since 2026-09-07')).toBe('');
    expect(ghostText('removed', 'Cloud Storage bucket: scratch-1', 'since 2026-09-07')).toBe(
      'Removed since 2026-09-07: Cloud Storage bucket: scratch-1',
    );
    expect(ghostText('hidden', 'Project: Reports', 'since 2026-09-16')).toBe(
      'No longer in this view since 2026-09-16: Project: Reports',
    );
    expect(descriptionText({ added: 1, removed: 1, changed: 1 }, 'since 2026-09-07')).toBe(
      'Changes since 2026-09-07: 1 added, 1 removed, 1 changed.',
    );
  });
});
