// SPDX-License-Identifier: MIT
/**
 * A pretend Google for the stream tests (never imported by the app, so neither bundle carries it): Cloud
 * Asset Inventory's `assets.list` and Cloud Storage's JSON API as an `UpstreamFetch`, recording every call,
 * on top of what every pretend Google shares (../upstream/google.testing.ts). The data is synthetic
 * (AGENTS.md, Security and privacy, principle 6): `demo-` project ids, numbers below 100000000000,
 * organisation 30000000001, example.com.
 */
import {
  caiPager,
  chunkedBody,
  htmlResponse,
  jsonResponse,
  recordCall,
  type RecordedCall,
} from '../upstream/google.testing.js';
import type { UpstreamFetch } from '../upstream/request.js';

export const READ_TIME = '2026-10-08T12:00:00.123456Z';

/** One synthetic Compute Engine instance in `assets.list` form, about 1.2 kB of JSON. */
export function syntheticAsset(index: number): Record<string, unknown> {
  const project = 1 + (index % 20);
  const projectNumber = String(10_000_000_000 + project);
  return {
    name: `//compute.googleapis.com/projects/demo-app-${String(project)}/zones/europe-west3-a/instances/vm-${String(index)}`,
    assetType: 'compute.googleapis.com/Instance',
    resource: {
      version: 'v1',
      discoveryDocumentUri: 'https://www.googleapis.com/discovery/v1/apis/compute/v1/rest',
      discoveryName: 'Instance',
      parent: `//cloudresourcemanager.googleapis.com/projects/${projectNumber}`,
      location: 'europe-west3-a',
      data: {
        name: `vm-${String(index)}`,
        machineType: `https://www.googleapis.com/compute/v1/projects/demo-app-${String(project)}/zones/europe-west3-a/machineTypes/e2-medium`,
        status: 'RUNNING',
        labels: { team: 'example', env: index % 2 === 0 ? 'prod' : 'dev' },
        networkInterfaces: [
          {
            network: `https://www.googleapis.com/compute/v1/projects/demo-net-1/global/networks/core`,
            subnetwork: `https://www.googleapis.com/compute/v1/projects/demo-net-1/regions/europe-west3/subnetworks/app`,
            networkIP: `10.${String(Math.floor(index / 250) % 250)}.${String(index % 250)}.10`,
          },
        ],
        disks: [
          {
            source: `https://www.googleapis.com/compute/v1/projects/demo-app-${String(project)}/zones/europe-west3-a/disks/vm-${String(index)}`,
            boot: true,
          },
        ],
        serviceAccounts: [
          { email: `app-${String(project)}@demo-app-${String(project)}.iam.gserviceaccount.com` },
        ],
      },
    },
    ancestors: [`projects/${projectNumber}`, 'folders/20000000001', 'organizations/30000000001'],
    updateTime: '2026-10-07T18:22:41.123456Z',
  };
}

/** `count` synthetic assets split into pages of `pageSize`. */
export function syntheticPages(count: number, pageSize = 500): Record<string, unknown>[][] {
  const pages: Record<string, unknown>[][] = [];
  for (let start = 0; start < count; start += pageSize) {
    pages.push(
      Array.from({ length: Math.min(pageSize, count - start) }, (_, offset) =>
        syntheticAsset(start + offset),
      ),
    );
  }
  return pages;
}

/** Answers a call instead of the default behaviour; `undefined` falls through to it. */
export type Override = (
  call: RecordedCall,
  index: number,
) => Response | undefined | Promise<Response | undefined>;

/**
 * Cloud Asset Inventory's `assets.list` over `pages`: the page token `page-N` asks for page N, and every page
 * but the last names the next. Requests without the method override get Google's HTML 404 (skill
 * cai-ingestion §9).
 */
export function mockCai(
  pages: readonly (readonly unknown[])[],
  options: { readonly readTime?: string; readonly override?: Override } = {},
): { readonly fetch: UpstreamFetch; readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const pager = caiPager(pages, options.readTime ?? READ_TIME);
  const fetch: UpstreamFetch = async (url, init) => {
    const call = recordCall(calls, url, init);
    const overridden = await options.override?.(call, calls.length - 1);
    if (overridden !== undefined) return overridden;
    if (call.url.host !== 'cloudasset.googleapis.com' || !call.url.pathname.endsWith('/assets'))
      return htmlResponse(404);
    return pager(call);
  };
  return { fetch, calls };
}

/**
 * Cloud Storage's JSON API over `objects` (name → content) in one bucket: object metadata, media downloads in
 * chunks, and prefix listings `listPageSize` items per page.
 */
export function mockGcs(
  bucket: string,
  objects: Readonly<Record<string, string>>,
  options: { readonly listPageSize?: number; readonly chunkSize?: number; readonly override?: Override } = {},
): { readonly fetch: UpstreamFetch; readonly calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const encoder = new TextEncoder();
  const names = Object.keys(objects).sort();
  const notFound = (): Response =>
    jsonResponse(404, { error: { code: 404, message: 'No such object.', errors: [{ reason: 'notFound' }] } });
  const fetch: UpstreamFetch = async (url, init) => {
    const call = recordCall(calls, url, init);
    const overridden = await options.override?.(call, calls.length - 1);
    if (overridden !== undefined) return overridden;
    const prefix = `/storage/v1/b/${encodeURIComponent(bucket)}/o`;
    if (call.url.host !== 'storage.googleapis.com' || !call.url.pathname.startsWith(prefix))
      return htmlResponse(404);
    const rest = call.url.pathname.slice(prefix.length);
    if (rest === '') {
      const wanted = call.url.searchParams.get('prefix') ?? '';
      const matching = names.filter((name) => name.startsWith(wanted));
      const size = options.listPageSize ?? 1000;
      const start = Number(call.url.searchParams.get('pageToken') ?? '0');
      const items = matching.slice(start, start + size).map((name) => ({
        name,
        size: String(encoder.encode(objects[name] ?? '').byteLength),
      }));
      return jsonResponse(200, {
        ...(items.length === 0 ? {} : { items }),
        ...(start + size < matching.length ? { nextPageToken: String(start + size) } : {}),
      });
    }
    const name = decodeURIComponent(rest.slice(1));
    const content = objects[name];
    if (content === undefined) return notFound();
    const bytes = encoder.encode(content);
    if (call.url.searchParams.get('alt') === 'media')
      return new Response(chunkedBody(bytes, options.chunkSize), {
        status: 200,
        headers: { 'content-type': 'application/octet-stream' },
      });
    return jsonResponse(200, { name, size: String(bytes.byteLength) });
  };
  return { fetch, calls };
}

/** The NDJSON lines of a body, parsed. */
export function linesOf(body: string): unknown[] {
  return body
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as unknown);
}
