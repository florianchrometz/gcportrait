// SPDX-License-Identifier: Apache-2.0

/** A non-null object that is not an array: a JSON object read from a file, a response body or storage. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Any non-null object, arrays included: enough to read a field of a worker message or a structured clone, whose
 * fields the caller checks one by one anyway.
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
