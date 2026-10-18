// SPDX-License-Identifier: Apache-2.0
/**
 * The rule engine runs on whatever Cloud Asset Inventory returns, so it must never throw and must keep its
 * output contract for asset data of any shape (fast-check over arbitrary JSON).
 */
import {
  DomainSchema,
  EvaluatedRelationSchema,
  IpSchema,
  NormaliserNameSchema,
  RelationTargetSchema,
  type Asset,
} from '@gcportrait/model';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { asset, PROJECTS } from '../testing/assets.js';
import { evaluateJsonPath } from './jsonpath.js';
import { normalise } from './normalisers.js';
import { evaluatePredicate } from './predicate.js';
import {
  evaluateContains,
  evaluateRelations,
  extractDomains,
  extractIps,
  isHiddenByDefault,
  renderConsoleUrl,
  renderLabel,
  renderSubtitle,
} from './rules.js';

const ctx = { projects: PROJECTS };

/** Strings that look a little like the values the rules read, plus arbitrary text. */
const referenceLike = fc.oneof(
  fc.string(),
  fc.constantFrom(
    'projects/demo-net-1/global/networks/core',
    'https://www.googleapis.com/compute/v1/projects/10000000001/regions/europe-west3/subnetworks/app',
    'gs://demo-logs-1/x',
    'demo-app-1:europe-west3:db',
    'runner@demo-app-1.iam.gserviceaccount.com',
    '%2F%2Fx.googleapis.com%2Fa',
    '10.0.0.1:80',
    'https://shop.example.org/a',
    '',
  ),
);

const data = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    referenceLike,
    fc.integer(),
    fc.double(),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie('value'), { maxLength: 4 }),
    fc.dictionary(
      fc.constantFrom('name', 'network', 'items', 'key', 'value', 'email', 'source', 'apiVersion', 'kind'),
      tie('value'),
      { maxKeys: 5 },
    ),
  ),
})).value;

const assets = data.map((value): Asset =>
  asset(
    '//compute.googleapis.com/projects/demo-app-1/zones/z/instances/i',
    'compute.googleapis.com/Instance',
    value,
  ),
);

const ENTRY = {
  role: 'core' as const,
  label: '{{data.name | lastSegment | short(12)}}',
  subtitle: '{{data.items[0].value}} · {{location}}',
  console: 'https://console.cloud.google.com/x/{{data.name}}?project={{projectId}}',
  ips: ['$.data.*', '$.data.items[*].value'],
  domains: ['$.data.*', '$.data.items[*].value'],
  hiddenWhen: "$.data.name startsWith 'a' || $.data.items[?(@.key == 'x')].value > 3",
  relations: NormaliserNameSchema.options.flatMap((normalize) =>
    ['$.data.*', '$.data.items[*]'].map((to) => ({ kind: 'uses' as const, to, normalize })),
  ),
  contains: ['$.data.items[*].value', { byParent: 'compute.googleapis.com/Disk' }],
};

describe('the rule engine on arbitrary data', () => {
  it('never throws and keeps its output contract', () => {
    fc.assert(
      fc.property(assets, (subject) => {
        for (const relation of evaluateRelations(subject, ENTRY, ctx))
          EvaluatedRelationSchema.parse(relation);
        for (const target of evaluateContains(subject, ENTRY, ctx).names) RelationTargetSchema.parse(target);
        for (const ip of extractIps(subject, ENTRY)) IpSchema.parse(ip);
        for (const domain of extractDomains(subject, ENTRY)) DomainSchema.parse(domain);
        expect(renderLabel(subject, ENTRY, ctx)).not.toBe('');
        expect(renderLabel(subject, undefined, ctx)).not.toBe('');
        expect(renderSubtitle(subject, ENTRY, ctx)).not.toBe('');
        const url = renderConsoleUrl(subject, ENTRY, ctx);
        if (url !== undefined) expect(url.startsWith('https://console.cloud.google.com/x/')).toBe(true);
        expect(typeof isHiddenByDefault(subject, ENTRY)).toBe('boolean');
      }),
      { numRuns: 300 },
    );
  });

  it('normalises any value to a valid target or to nothing', () => {
    fc.assert(
      fc.property(fc.constantFrom(...NormaliserNameSchema.options), data, (normaliser, value) => {
        const subject = asset(
          '//container.googleapis.com/projects/demo-app-1/locations/l/clusters/c/k8s/namespaces/n/pods/p',
          'k8s.io/Pod',
          {},
        );
        const target = normalise(normaliser, value, {
          asset: subject,
          projects: PROJECTS,
          service: 'run.googleapis.com',
          versionLevel: false,
        });
        if (target !== undefined) RelationTargetSchema.parse(target);
      }),
      { numRuns: 500 },
    );
  });

  it('evaluates paths and predicates on any value without throwing', () => {
    fc.assert(
      fc.property(data, (value) => {
        expect(Array.isArray(evaluateJsonPath("$.items[?(@.key == 'k')].value", value))).toBe(true);
        expect(Array.isArray(evaluateJsonPath('$..x', value))).toBe(true);
        expect(typeof evaluatePredicate("$.name in ['a', 1, null] || !$.items[*].value", value)).toBe(
          'boolean',
        );
      }),
      { numRuns: 300 },
    );
  });
});
