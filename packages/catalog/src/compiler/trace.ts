// SPDX-License-Identifier: Apache-2.0
/**
 * Rule traces for reviewers (`pnpm catalog:check --verbose`): for every rule of a type, every value it reads
 * from each fixture and what the rule engine made of it (rule → fixture value → normalised name), plus each
 * template as rendered. Built with the engine itself, so it shows exactly what the graph builder will see.
 */
import type { Asset, CatalogTypeEntry, RelationTarget } from '@gcportrait/model';
import { aliasKey } from '@gcportrait/model';
import { evaluateJsonPath } from '../engine/jsonpath.js';
import { normalise } from '../engine/normalisers.js';
import {
  evaluateNestsIn,
  evaluateRelations,
  hiddenWhenMatches,
  serviceOf,
  templateScope,
  toDomain,
  toIp,
  type RuleContext,
} from '../engine/rules.js';
import { renderTemplate } from '../engine/template.js';
import type { RuleTrace, TraceResult, TypeTrace } from './types.js';

function raw(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function targetText(target: RelationTarget | undefined): string | undefined {
  if (target === undefined) return undefined;
  return target.by === 'name' ? target.name : `alias:${target.alias}`;
}

function result(fixture: Asset, value: unknown, resolved: string | undefined): TraceResult {
  return { fixture: fixture.name, raw: raw(value), ...(resolved === undefined ? {} : { resolved }) };
}

/** Reads a path on every fixture and converts each value. */
function valuesThrough(
  fixtures: readonly Asset[],
  path: string,
  convert: (value: unknown, fixture: Asset) => string | undefined,
): TraceResult[] {
  return fixtures.flatMap((fixture) =>
    evaluateJsonPath(path, fixture).map((value) => result(fixture, value, convert(value, fixture))),
  );
}

/** Every rule and template of one type, traced over its fixtures. */
export function traceType(
  assetType: string,
  file: string,
  entry: CatalogTypeEntry,
  fixtures: readonly Asset[],
  ctx: RuleContext,
): TypeTrace {
  const rules: RuleTrace[] = [];
  entry.relations.forEach((rule, i) => {
    rules.push({
      rule: `relations[${String(i)}] ${rule.kind} ${rule.to} → ${rule.normalize}${rule.weak === true ? ' (weak)' : ''}${rule.reverse === true ? ' (reverse: drawn target → asset)' : ''}`,
      results: fixtures.flatMap((fixture) =>
        evaluateRelations(fixture, { relations: [rule] }, ctx).map((relation): TraceResult => ({
          fixture: fixture.name,
          raw: relation.raw,
          ...(relation.target === undefined
            ? {}
            : {
                resolved:
                  relation.target.by === 'name' ? relation.target.name : `alias:${relation.target.alias}`,
              }),
        })),
      ),
    });
  });
  (entry.nestsIn ?? []).forEach((rule, i) => {
    rules.push({
      rule: `nestsIn[${String(i)}] ${rule.to} → ${rule.normalize}${rule.kind === undefined ? '' : ` (else ${rule.kind})`}`,
      results: fixtures.flatMap((fixture) =>
        evaluateNestsIn(fixture, { nestsIn: [rule] }, ctx).map((nesting): TraceResult =>
          result(fixture, nesting.raw, targetText(nesting.target)),
        ),
      ),
    });
  });
  entry.ips.forEach((path, i) => {
    rules.push({ rule: `ips[${String(i)}] ${path}`, results: valuesThrough(fixtures, path, toIp) });
  });
  entry.domains.forEach((path, i) => {
    rules.push({ rule: `domains[${String(i)}] ${path}`, results: valuesThrough(fixtures, path, toDomain) });
  });
  entry.contains.forEach((rule, i) => {
    if (typeof rule !== 'string') {
      rules.push({ rule: `contains[${String(i)}] byParent ${rule.byParent}`, results: [] });
      return;
    }
    rules.push({
      rule: `contains[${String(i)}] ${rule}`,
      results: valuesThrough(fixtures, rule, (value, fixture) =>
        targetText(
          normalise('name', value, {
            asset: fixture,
            projects: ctx.projects,
            service: serviceOf(assetType),
            versionLevel: false,
          }),
        ),
      ),
    });
  });
  (entry.aliases ?? []).forEach((path, i) => {
    rules.push({
      rule: `aliases[${String(i)}] ${path}`,
      results: valuesThrough(fixtures, path, (value) =>
        typeof value === 'string' ? aliasKey(value) : undefined,
      ),
    });
  });
  const { hiddenWhen } = entry;
  if (typeof hiddenWhen === 'string') {
    rules.push({
      rule: `hiddenWhen ${hiddenWhen}`,
      results: fixtures.map((fixture) => ({
        fixture: fixture.name,
        raw: hiddenWhen,
        resolved: hiddenWhenMatches(fixture, entry) ? 'matches: starts hidden' : 'does not match: visible',
      })),
    });
  }
  const templates: Array<[string, string | undefined]> = [
    ['label', entry.label],
    ['subtitle', entry.subtitle],
    ['console', entry.console],
  ];
  for (const [field, template] of templates) {
    if (template === undefined) continue;
    rules.push({
      rule: `${field} ${template}`,
      results: fixtures.map((fixture) => {
        const rendered = renderTemplate(template, templateScope(fixture, ctx));
        return {
          fixture: fixture.name,
          raw: template,
          resolved: rendered.missing ? `${rendered.text} [a variable is missing]` : rendered.text,
        };
      }),
    });
  }
  return { assetType, file, rules };
}
