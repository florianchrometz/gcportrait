// SPDX-License-Identifier: Apache-2.0
/**
 * Turns normalised assets back into Cloud Asset Inventory records: `resource.{version, discoveryDocumentUri,
 * discoveryName, parent, data, location}` around the data, as `assets.list` returns them (camelCase keys) or
 * as `exportAssets` writes them to Cloud Storage (snake_case envelope keys; `data` itself is unchanged).
 */
import type { Asset } from '@gcportrait/model';
import { discoveryFor } from '../data/discovery.js';

/** `api`: the `assets.list` response shape. `export`: the NDJSON that `exportAssets` writes. */
export type CaiKeyStyle = 'api' | 'export';

export interface CaiResource {
  readonly version: string;
  readonly discoveryDocumentUri: string;
  readonly discoveryName: string;
  readonly parent?: string;
  readonly data: unknown;
  readonly location?: string;
}

/** One asset in the `assets.list` shape. */
export interface CaiAsset {
  readonly name: string;
  readonly assetType: string;
  readonly resource: CaiResource;
  readonly ancestors: readonly string[];
  readonly updateTime: string;
}

export function toCaiAsset(asset: Asset): CaiAsset {
  const discovery = discoveryFor(asset.assetType);
  return {
    name: asset.name,
    assetType: asset.assetType,
    resource: {
      version: discovery.version,
      discoveryDocumentUri: discovery.discoveryDocumentUri,
      discoveryName: discovery.discoveryName,
      ...(asset.parent === undefined ? {} : { parent: asset.parent }),
      data: asset.data,
      ...(asset.location === undefined ? {} : { location: asset.location }),
    },
    ancestors: asset.ancestors,
    updateTime: asset.updateTime,
  };
}

function exportRecord(asset: Asset): Record<string, unknown> {
  const discovery = discoveryFor(asset.assetType);
  return {
    name: asset.name,
    asset_type: asset.assetType,
    resource: {
      version: discovery.version,
      discovery_document_uri: discovery.discoveryDocumentUri,
      discovery_name: discovery.discoveryName,
      ...(asset.parent === undefined ? {} : { parent: asset.parent }),
      data: asset.data,
      ...(asset.location === undefined ? {} : { location: asset.location }),
    },
    ancestors: asset.ancestors,
    update_time: asset.updateTime,
  };
}

/** One JSON object per line, each line ending in `\n`. */
export function toCaiNdjson(assets: readonly Asset[], style: CaiKeyStyle = 'api'): string {
  let out = '';
  for (const asset of assets) {
    out += `${JSON.stringify(style === 'api' ? toCaiAsset(asset) : exportRecord(asset))}\n`;
  }
  return out;
}

/** The UTF-8 size of `text`. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}
