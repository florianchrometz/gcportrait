// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  AssetTypePatternSchema,
  AssetTypeSchema,
  CountSchema,
  DateSchema,
  DomainSchema,
  IconKeySchema,
  IpSchema,
  LocationSchema,
  NonEmptyStringSchema,
  NumericIdSchema,
  ProjectRefSchema,
  ResourceNameSchema,
  ServiceNameSchema,
  TextSchema,
  TimestampSchema,
  UlidSchema,
} from './primitives.js';

const cases: [string, z.ZodType, unknown[], unknown[]][] = [
  ['NonEmptyStringSchema', NonEmptyStringSchema, ['a', ' '], ['', 1, null]],
  ['TextSchema', TextSchema, ['web & api', 'é😀', '%2C'], ['', '\uD800', 'a\uDC00b', 7]],
  [
    'UlidSchema',
    UlidSchema,
    ['01J9Z3K5Q8XW2V4N6P7R8S9T0A', '7ZZZZZZZZZZZZZZZZZZZZZZZZZ'],
    [
      '01j9z3k5q8xw2v4n6p7r8s9t0a',
      '81J9Z3K5Q8XW2V4N6P7R8S9T0A',
      '01J9Z3K5Q8XW2V4N6P7R8S9T0',
      '01J9Z3K5Q8XW2V4N6P7R8S9TIL',
    ],
  ],
  [
    'ServiceNameSchema',
    ServiceNameSchema,
    ['compute.googleapis.com', 'k8s.io'],
    ['compute', 'Compute.googleapis.com', ''],
  ],
  [
    'AssetTypeSchema',
    AssetTypeSchema,
    ['compute.googleapis.com/Instance', 'rbac.authorization.k8s.io/ClusterRole', 'k8s.io/Pod'],
    [
      'compute.googleapis.com/*',
      'Instance',
      'compute.googleapis.com/',
      'compute.googleapis.com/Instance/x',
      '*',
    ],
  ],
  [
    'AssetTypePatternSchema',
    AssetTypePatternSchema,
    ['compute.googleapis.com/Instance', 'run.googleapis.com/*', '*'],
    ['**', 'run.googleapis.com/S*', 'run/*', ''],
  ],
  [
    'ResourceNameSchema',
    ResourceNameSchema,
    [
      '//compute.googleapis.com/projects/p/zones/z/instances/i',
      '//bigquery.googleapis.com/projects/p/datasets/d/tables/a b',
    ],
    ['compute.googleapis.com/projects/p', '//compute/projects/p', '//compute.googleapis.com/', ''],
  ],
  [
    'ProjectRefSchema',
    ProjectRefSchema,
    ['demo-net', '10000000001', 'example.com:legacy-app'],
    ['Demo', '-net', ''],
  ],
  ['NumericIdSchema', NumericIdSchema, ['20000000001', '7'], ['0', '012', 'folders/1', '']],
  [
    'LocationSchema',
    LocationSchema,
    ['global', 'europe-west3', 'europe-west3-a', 'EU'],
    ['-eu', 'europe west', ''],
  ],
  [
    'IpSchema',
    IpSchema,
    ['10.10.0.2', '203.0.113.0/24', '2001:db8::1', '2001:db8::/32'],
    ['10.10.0.256', 'example.com', ''],
  ],
  [
    'DomainSchema',
    DomainSchema,
    ['www.example.com', '*.example.com', '_acme-challenge.example.com', 'localhost'],
    ['WWW.example.com', 'www..example.com', '-www.example.com', 'www.example.com.', 'a'.repeat(254)],
  ],
  [
    'IconKeySchema',
    IconKeySchema,
    ['compute_engine', 'cloud_run', 'k8s'],
    ['Compute', 'cloud-run', '_x', 'x_', ''],
  ],
  [
    'TimestampSchema',
    TimestampSchema,
    ['2026-10-07T18:22:41.123456Z', '2026-10-07T18:22:41+02:00', '2026-10-07T18:22:41Z'],
    ['2026-10-07', '2026-10-07T18:22:41', 'yesterday'],
  ],
  [
    'DateSchema',
    DateSchema,
    ['2026-10-08', '2024-02-29'],
    ['2026-02-29', '2026-13-01', '2026-10-8', '20261008'],
  ],
  ['CountSchema', CountSchema, [0, 42], [-1, 1.5, Number.NaN, '3']],
];

describe.each(cases)('%s', (_name, schema, accepted, rejected) => {
  it.each(accepted)('accepts %j', (value) => {
    expect(schema.safeParse(value).success).toBe(true);
  });
  it.each(rejected)('rejects %j', (value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});
