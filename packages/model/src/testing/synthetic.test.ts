// SPDX-License-Identifier: MIT
import { describe, expect, it } from 'vitest';
import {
  assertSyntheticOnly,
  findNonSyntheticData,
  formatSyntheticFindings,
  type SyntheticFindingKind,
} from './synthetic.js';

// Negative examples are assembled from parts so that no real-looking value appears verbatim in the source.
const dot = (...parts: string[]): string => parts.join('.');
const someCompany = dot(['widget', 'works'].join('-'), 'com');
const realNumber = ['1234', '5678', '9012'].join('');
const realProject = ['acme', 'prod', '42'].join('-');

function kinds(text: string): SyntheticFindingKind[] {
  return findNonSyntheticData(text).map((finding) => finding.kind);
}

describe('findNonSyntheticData', () => {
  it('accepts synthetic data', () => {
    const clean = [
      '{"email":"ops@example.com","owner":"team@corp.example.org","url":"https://shop.example.org/cart"}',
      '"serviceAccount":"web-frontend@demo-web-1.iam.gserviceaccount.com"',
      '"agent":"service-10000000007@gcp-sa-pubsub.iam.gserviceaccount.com","default":"10000000005-compute@developer.gserviceaccount.com"',
      '"sql":"p10000000007-a1b2c3@gcp-sa-cloud-sql.iam.gserviceaccount.com"',
      '"parent":"//cloudresourcemanager.googleapis.com/projects/10000000001","ancestors":["folders/20000000001","organizations/30000000001"]',
      '"projectNumber":"99999999999","organizationId":"30000000001"',
      '"parent":{"type":"organization","id":"30000000001"},"p2":{"id":"20000000001","type":"folder"}',
      '"ip":"10.0.0.2","nat":"203.0.113.10","range":"172.16.0.0/12","bgp":"169.254.0.1/30","default":"0.0.0.0/0","doc":"198.51.100.7"',
      '"image":"europe-west3-docker.pkg.dev/demo-web-1/apps/api:1.2.3","uri":"https://api-abc-ey.a.run.app"',
      '"url":"https://shop-10000000002.europe-west3.run.app"',
      '"kind":"k8s.io/Pod","label":"app.kubernetes.io/name","annotation":"cloud.google.com/neg"',
      '"knative":"serving.knative.dev/creator","autoscaling":"autoscaling.knative.dev/maxScale"',
      '"version":"1.33.4-gke.1245000","time":"2026-10-07T18:22:41.123456Z","file":"main.py","page":"index.html"',
      '"v6":"2001:db8::1","ula":"fd00::/8","ll":"fe80::1","any":"::/0"',
      '"selfLink":"https://www.googleapis.com/compute/v1/projects/demo-net-1/global/networks/core"',
      '"image":"https://www.googleapis.com/compute/v1/projects/debian-cloud/global/images/debian-12"',
      '"peer":"https://www.googleapis.com/compute/v1/projects/a1b2c3d4e5f6-tp/global/networks/servicenetworking"',
      '"name":"//compute.googleapis.com/projects/demo-app-1/zones/europe-west3-a/instances/web-1"',
      '"projectId":"demo-data-1","placeholder":"projects/p/zones/z","template":"projects/{{projectId}}"',
      'const last = items.at(-1); const ok = value.no(1);',
    ].join('\n');
    expect(findNonSyntheticData(clean)).toEqual([]);
    expect(() => {
      assertSyntheticOnly(clean);
    }).not.toThrow();
  });

  it('reports e-mail addresses outside the example domains', () => {
    expect(kinds(`"email":"jane@${someCompany}"`)).toEqual(['email']);
    expect(kinds(`"sa":"runner@${realProject}.iam.gserviceaccount.com"`)).toEqual(['email']);
    expect(kinds(`"agent":"service-${realNumber}@gcp-sa-pubsub.iam.gserviceaccount.com"`)).toEqual([
      'email',
      'project-number',
    ]);
  });

  it('reports host names outside the example and platform domains', () => {
    expect(kinds(`"url":"https://portal.${someCompany}/login"`)).toEqual(['domain']);
    expect(kinds(`see ${dot('admin', 'widget-works', 'io')} for details`)).toEqual(['domain']);
    expect(kinds('"dnsName":"shop.example.org."')).toEqual([]);
  });

  it('reports real-looking project, folder and organisation numbers', () => {
    expect(kinds(`"parent":"projects/${realNumber}"`)).toEqual(['project-number']);
    expect(kinds(`"projectNumber": "${realNumber}"`)).toEqual(['project-number']);
    expect(kinds('"name":"folders/412345678901"')).toEqual(['folder-number']);
    expect(kinds('"ancestors":["organizations/30000000005"]')).toEqual(['organization-id']);
    // The demo organisations S, M, L and XL.
    expect(kinds('"ancestors":["organizations/30000000002","organizations/30000000004"]')).toEqual([]);
  });

  it('reports Resource Manager v1 parents in either key order', () => {
    expect(kinds('"parent":{"type":"organization","id":"424242"}')).toEqual(['organization-id']);
    expect(kinds(`"parent":{"id":"${realNumber}","type":"folder"}`)).toEqual(['folder-number']);
    expect(kinds(`"parent":{"type": "project", "id": "${realNumber}"}`)).toEqual(['project-number']);
  });

  it('reports organisation ids in organizationId fields', () => {
    expect(kinds('"organizationId":"424242"')).toEqual(['organization-id']);
    expect(kinds('"organizationId": 424242')).toEqual(['organization-id']);
  });

  it('reports project numbers inside Cloud Run hosts', () => {
    expect(kinds(`"url":"https://shop-${realNumber}.europe-west3.run.app"`)).toEqual(['project-number']);
  });

  it('reports real-looking project ids in self-links, full names and projectId fields', () => {
    expect(
      kinds(`"network":"https://www.googleapis.com/compute/v1/projects/${realProject}/global/networks/n"`),
    ).toEqual(['project-id']);
    expect(kinds(`"name":"//compute.googleapis.com/projects/${realProject}/global/networks/n"`)).toEqual([
      'project-id',
    ]);
    expect(kinds(`"projectId":"${realProject}"`)).toEqual(['project-id']);
    expect(
      kinds(`"name":"//sqladmin.googleapis.com/projects/example.com:${realProject}/instances/i"`),
    ).toEqual(['project-id']);
  });

  it('reports addresses outside private and documentation space', () => {
    expect(kinds(`"ip":"${dot('8', '8', '4', '4')}"`)).toEqual(['ip']);
    expect(kinds(`"sourceRanges":["${dot('35', '191', '0', '0')}/16"]`)).toEqual(['ip']);
    expect(kinds('"range":"10.0.0.0/7"')).toEqual(['ip']);
    expect(kinds('"v6":"2606:4700::1111"')).toEqual(['ip']);
    expect(kinds('"notAnIp":"300.1.1.1","prefix":"10.0.0.0/40","quads":"1.2.3 1.2.3.4.5"')).toEqual([]);
    expect(kinds('"notV6":"1:2:3","bad":"12345::1","colons":":::"')).toEqual([]);
  });

  it("accepts the managed services' own hosts and the shared address space", () => {
    const managed = [
      '"defaultHostname":"orders-gw-1a2b3c4d.ew.gateway.dev"',
      '"html":"repos-10000000004.europe-west3.sourcemanager.dev"',
      '"cloneUri":"https://europe-west3-git.developerconnect.dev/a/b/demo.git"',
      '"lookerUri":"https://analytics.europe-west3.looker.app"',
      '"jsonRpcApiEndpoint":"json-rpc.abc123.blockchainnodeengine.com"',
      '"rrdata":"ghs.googlehosted.com.","dns":"europe-west3.domains.cloudrun.com"',
      '"internalIpRange":"100.64.128.0/20","address":"100.127.255.254"',
    ].join('\n');
    expect(findNonSyntheticData(managed)).toEqual([]);
  });

  it('keeps the guard narrow around those hosts and ranges', () => {
    expect(kinds(`"url":"https://${dot('www', 'googlehosted', 'com')}"`)).toEqual(['domain']);
    expect(kinds(`"url":"https://${dot('mirror', 'cloudrun', 'com')}"`)).toEqual(['domain']);
    expect(kinds(`"address":"${dot('100', '128', '0', '1')}"`)).toEqual(['ip']);
    expect(kinds(`"range":"${dot('100', '0', '0', '0')}/8"`)).toEqual(['ip']);
  });

  it('honours custom options', () => {
    expect(findNonSyntheticData('"ip":"192.168.1.1"', { allowedIpv4Ranges: ['10.0.0.0/8'] })).toHaveLength(1);
    expect(
      findNonSyntheticData('"sa":"x@my-proj.iam.gserviceaccount.com"', { projectIdPattern: /^my-/ }),
    ).toEqual([]);
    expect(findNonSyntheticData('"o":"organizations/42"', { organizationIds: ['42'] })).toEqual([]);
    expect(findNonSyntheticData('"p":"projects/123"', { numberLimit: 100 })).toHaveLength(1);
    expect(
      findNonSyntheticData('x@corp.test.io https://a.test.io', {
        exampleDomains: ['test.io'],
        platformDomains: [],
      }),
    ).toEqual([]);
    expect(findNonSyntheticData('"a":"prod@appspot.gserviceaccount.com"')).toHaveLength(1);
    expect(findNonSyntheticData('"a":"demo-web-1@appspot.gserviceaccount.com"')).toEqual([]);
  });

  it('reports line numbers and summarises findings when asserting', () => {
    const text = `ok\n"a":"organizations/1"\n"b":"projects/${realNumber}"\n`;
    expect(findNonSyntheticData(text).map((f) => f.line)).toEqual([2, 3]);
    expect(() => {
      assertSyntheticOnly(text, {}, 'fixture.ndjson');
    }).toThrow(/fixture\.ndjson contains data that does not look synthetic:\n {2}line 2: organization-id/);
    const many = Array.from({ length: 25 }, (_, i) => `"o":"organizations/${String(i + 1)}"`).join('\n');
    const lines = formatSyntheticFindings(findNonSyntheticData(many));
    expect(lines).toHaveLength(21);
    expect(lines.at(-1)).toBe('… and 5 more');
  });

  it('masks e-mail addresses in linear time (no quadratic copying on large inputs)', () => {
    const text = Array.from({ length: 40_000 }, (_, i) => `"m":"user${String(i)}@example.com"`).join('\n');
    const started = Date.now();
    expect(findNonSyntheticData(text)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
