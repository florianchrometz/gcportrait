// SPDX-License-Identifier: Apache-2.0
/** Writes an asset's creation and update instants into the timestamp fields of its `data`. */
import { setPath, type JsonObject } from '../core/json.js';
import { computeTimestamp, epochMillis, rfc3339Micros, rfc3339Millis, rfc3339Seconds } from '../core/time.js';
import { timestampFields, type TimestampFormat } from '../data/timestamps.js';
import type { GenAsset } from './types.js';

function formatInstant(format: TimestampFormat, ms: number, salt: string): string {
  switch (format) {
    case 'rfc3339-micros':
      return rfc3339Micros(ms, salt);
    case 'rfc3339-millis':
      return rfc3339Millis(ms);
    case 'rfc3339-seconds':
      return rfc3339Seconds(ms);
    case 'compute':
      return computeTimestamp(ms);
    case 'epoch-millis':
      return epochMillis(ms);
  }
}

/** `data` with every timestamp field of `assetType` set from the two instants. */
export function stampTimestamps(
  assetType: string,
  salt: string,
  data: JsonObject,
  createdAt: number,
  updatedAt: number,
): JsonObject {
  let out = data;
  for (const field of timestampFields(assetType)) {
    const instant = (field.role === 'created' ? createdAt : updatedAt) + (field.offsetMs ?? 0);
    out = setPath(out, field.path, formatInstant(field.format, instant, salt));
  }
  return out;
}

/** The asset as if it had been created (and last updated) at `at`. */
export function retime(asset: GenAsset, at: number): GenAsset {
  return {
    ...asset,
    createdAt: at,
    updatedAt: at,
    data: stampTimestamps(asset.assetType, asset.name, asset.data, at, at),
  };
}

/** The asset with new `data`, updated at `at`. */
export function touch(asset: GenAsset, data: JsonObject, at: number): GenAsset {
  return {
    ...asset,
    updatedAt: at,
    data: stampTimestamps(asset.assetType, asset.name, data, asset.createdAt, at),
  };
}
