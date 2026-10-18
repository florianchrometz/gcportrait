// SPDX-License-Identifier: Apache-2.0
/**
 * Tests that the catalog normalisers match the specification in the catalog skill
 * (.agents/skills/gcp-asset-catalog/SKILL.md §5).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NormaliserNameSchema } from '@gcportrait/model';
import { describe, expect, it } from 'vitest';
import { NORMALISERS } from '../src/index.js';

const skillPath = path.resolve(import.meta.dirname, '../../../.agents/skills/gcp-asset-catalog/SKILL.md');
const skillText = readFileSync(skillPath, 'utf8');

function extractNormalisersFromSkill(): string[] {
  const start = skillText.indexOf('## 5. Normalisers');
  if (start === -1) throw new Error('Missing heading "## 5. Normalisers" in catalog skill');
  const end = skillText.indexOf('## 6.', start);
  const section = end === -1 ? skillText.slice(start) : skillText.slice(start, end);

  const names: string[] = [];
  for (const line of section.split('\n')) {
    const match = /^\|\s*`([A-Za-z0-9]+)`\s*\|/.exec(line);
    const name = match?.[1];
    if (name !== undefined) {
      names.push(name);
    }
  }
  return names;
}

describe('gcp-asset-catalog skill §5 normalisers', () => {
  it('documents every implemented normaliser and no extra ones', () => {
    const skillNormalisers = extractNormalisersFromSkill();
    const implementedNormalisers = Object.keys(NORMALISERS);
    const modelOptions = [...NormaliserNameSchema.options];

    expect(skillNormalisers.sort()).toEqual(implementedNormalisers.sort());
    expect(skillNormalisers.sort()).toEqual(modelOptions.sort());
  });
});
