// SPDX-License-Identifier: Apache-2.0
/**
 * Test helper (not part of the public API): the error a call throws, for assertions on its fields. Fails the
 * test when the call throws nothing, so the assertions that follow always run; rethrows an error of another
 * class.
 */
export function thrownBy<E extends Error>(fn: () => unknown, type: new (...args: never[]) => E): E {
  try {
    fn();
  } catch (error) {
    if (error instanceof type) return error;
    throw error;
  }
  throw new Error(`expected a ${type.name}`);
}
