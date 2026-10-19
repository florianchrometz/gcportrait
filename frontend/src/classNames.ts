// SPDX-License-Identifier: Apache-2.0

/** Joins CSS module class names, skipping missing ones (an unknown CSS-module key is undefined). */
export function cx(...classNames: readonly (string | false | null | undefined)[]): string {
  return classNames.filter((name): name is string => typeof name === 'string' && name !== '').join(' ');
}
