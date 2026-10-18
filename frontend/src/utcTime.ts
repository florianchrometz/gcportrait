// SPDX-License-Identifier: MIT
export function formatUtcMinute(instant: number): string {
  const iso = new Date(instant).toISOString();
  const separator = iso.indexOf('T');
  return `${iso.slice(0, separator)} ${iso.slice(separator + 1, separator + 6)} UTC`;
}
