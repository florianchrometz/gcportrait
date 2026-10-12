// SPDX-License-Identifier: MIT
/** IPv4 arithmetic and the address plan's allocators. */

export interface Cidr {
  readonly base: number;
  readonly prefix: number;
}

export function ipToInt(ip: string): number {
  const parts = ip.split('.');
  if (parts.length !== 4) throw new RangeError(`"${ip}" is not an IPv4 address`);
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!/^\d{1,3}$/.test(part) || octet > 255) throw new RangeError(`"${ip}" is not an IPv4 address`);
    value = value * 256 + octet;
  }
  return value;
}

export function intToIp(value: number): string {
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].map(String).join('.');
}

export function parseCidr(cidr: string): Cidr {
  const [ip, prefixText] = cidr.split('/');
  const prefix = prefixText === undefined ? 32 : Number(prefixText);
  if (ip === undefined || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new RangeError(`"${cidr}" is not an IPv4 CIDR range`);
  }
  return { base: ipToInt(ip), prefix };
}

export function formatCidr({ base, prefix }: Cidr): string {
  return `${intToIp(base)}/${String(prefix)}`;
}

function blockSize(prefix: number): number {
  return 2 ** (32 - prefix);
}

/** True when `inner` (an address or a range) lies entirely inside `outer`. */
export function cidrContains(outer: string, inner: string): boolean {
  const o = parseCidr(outer);
  const i = parseCidr(inner);
  if (i.prefix < o.prefix) return false;
  const start = o.base - (o.base % blockSize(o.prefix));
  return i.base >= start && i.base + blockSize(i.prefix) <= start + blockSize(o.prefix);
}

/** The address `offset` places into a range: `hostAt('10.0.0.0/24', 2)` is `10.0.0.2`. */
export function hostAt(cidr: string, offset: number): string {
  const { base, prefix } = parseCidr(cidr);
  if (offset < 0 || offset >= blockSize(prefix)) {
    throw new RangeError(`offset ${String(offset)} is outside ${cidr}`);
  }
  return intToIp(base + offset);
}

/**
 * Hands out aligned sub-ranges of one parent range in order. Allocation is deterministic: the same sequence
 * of requests always yields the same ranges. Throws when the parent range is exhausted, so a size profile
 * that asks for too much fails loudly in the tests instead of producing overlapping ranges.
 */
export class CidrPool {
  readonly #parent: Cidr;
  readonly #label: string;
  #cursor: number;

  constructor(parent: string, label: string) {
    this.#parent = parseCidr(parent);
    this.#label = label;
    this.#cursor = this.#parent.base;
  }

  allocate(prefix: number): string {
    const size = blockSize(prefix);
    const start = Math.ceil(this.#cursor / size) * size;
    if (prefix < this.#parent.prefix || start + size > this.#parent.base + blockSize(this.#parent.prefix)) {
      throw new RangeError(`the ${this.#label} pool ${formatCidr(this.#parent)} is exhausted`);
    }
    this.#cursor = start + size;
    return formatCidr({ base: start, prefix });
  }

  /** A single address. */
  address(): string {
    return this.allocate(32).replace(/\/32$/, '');
  }
}

/** Hands out the host addresses of one range in order, skipping the network and gateway addresses. */
export class HostPool {
  readonly #cidr: string;
  #next: number;

  constructor(cidr: string, firstOffset = 2) {
    this.#cidr = cidr;
    this.#next = firstOffset;
  }

  next(): string {
    const ip = hostAt(this.#cidr, this.#next);
    this.#next += 1;
    return ip;
  }
}
