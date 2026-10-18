// SPDX-License-Identifier: Apache-2.0
/** JSON value types and structural-sharing updates for the generated `resource.data` objects. */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject;
export interface JsonObject {
  [key: string]: JsonValue;
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value at `path`, or `undefined` when a step is missing or not an object. */
export function getPath(value: JsonObject, path: readonly string[]): JsonValue | undefined {
  let current: JsonValue | undefined = value;
  for (const key of path) {
    if (!isJsonObject(current)) return undefined;
    current = current[key];
  }
  return current;
}

/**
 * A copy of `value` with `path` set to `next`. Only the objects along the path are copied; everything else is
 * shared, which is safe because generated data is never mutated after it is built. Missing intermediate
 * objects are created.
 */
export function setPath(value: JsonObject, path: readonly string[], next: JsonValue): JsonObject {
  const [key, ...rest] = path;
  if (key === undefined) throw new RangeError('setPath needs a non-empty path');
  if (rest.length === 0) return { ...value, [key]: next };
  const child = value[key];
  return { ...value, [key]: setPath(isJsonObject(child) ? child : {}, rest, next) };
}

/** A copy of `value` with `path` applied through `update`. */
export function updatePath(
  value: JsonObject,
  path: readonly string[],
  update: (current: JsonValue | undefined) => JsonValue,
): JsonObject {
  return setPath(value, path, update(getPath(value, path)));
}
