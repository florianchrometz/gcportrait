// SPDX-License-Identifier: MIT
/**
 * The "synthetic only" guard (agents.md rule 6, ADR 0014, skill cai-ingestion §7): one sweep
 * over text (a fixture file, an NDJSON export, a JSON document, a source file) that reports anything that looks
 * like real organisation data. It is the only implementation: the demo-data generator, the catalog compiler's
 * fixture check and the ingest tests all call it, with the one allowlist below. Pure, no dependencies, and
 * linear in the length of the text.
 *
 * What counts as synthetic:
 *  - e-mail addresses at example.com / example.org / example.net (or a subdomain), and Google service-account
 *    addresses (gserviceaccount.com) whose project id is synthetic (`demo-…`) and whose embedded numbers are
 *    synthetic;
 *  - host names under the example domains or the platform domains the APIs themselves use (googleapis.com,
 *    run.app, pkg.dev, k8s.io, serving.knative.dev, gateway.dev, looker.app, …); a project number inside a Cloud Run host
 *    (`<service>-<number>.<region>.run.app`) is still a project number;
 *  - project and folder numbers below 100000000000 wherever they appear (`projects/N`, `folders/N`,
 *    `projectNumber`, service-agent addresses, Resource Manager v1 `{ "type": "folder", "id": "N" }` parents,
 *    Cloud Run hosts);
 *  - the organisations 30000000001 to 30000000004 only, the demo organisations S, M, L and XL (`organizations/N`,
 *    `organizationId`, v1 `{ "type": "organization" }` parents; one per size);
 *  - project ids in self-links and full resource names (`…googleapis.com/compute/v1/projects/<id>/…`,
 *    `//…googleapis.com/projects/<id>/…`) and in `projectId` fields: `demo-…`, or a Google-owned project
 *    (public image projects such as `debian-cloud`, producer tenant projects `…-tp`);
 *  - IPv4 addresses and ranges inside private (RFC 1918), shared (RFC 6598), link-local, loopback or
 *    documentation (RFC 5737) space, plus 0.0.0.0/0; IPv6 inside the documentation, unique-local or link-local
 *    prefixes.
 */

export type SyntheticFindingKind =
  'email' | 'domain' | 'project-number' | 'project-id' | 'folder-number' | 'organization-id' | 'ip';

export interface SyntheticFinding {
  readonly kind: SyntheticFindingKind;
  readonly value: string;
  /** 1-based line of the match. */
  readonly line: number;
}

export interface SyntheticGuardOptions {
  /** Email and host domains (and their subdomains) that are synthetic. */
  readonly exampleDomains?: readonly string[];
  /** Host domains (and their subdomains) of the platform itself, never customer data. */
  readonly platformDomains?: readonly string[];
  /** Project ids that are synthetic (service-account addresses, self-links, full names, `projectId`). */
  readonly projectIdPattern?: RegExp;
  /** Project and folder numbers must be below this. */
  readonly numberLimit?: number;
  readonly organizationIds?: readonly string[];
  /** IPv4 CIDR ranges an address or range must lie in. */
  readonly allowedIpv4Ranges?: readonly string[];
}

export const EXAMPLE_DOMAINS: readonly string[] = ['example.com', 'example.org', 'example.net'];

export const PLATFORM_DOMAINS: readonly string[] = [
  'googleapis.com',
  'gserviceaccount.com',
  'google.com',
  'googleusercontent.com',
  'googledomains.com',
  'gcr.io',
  'pkg.dev',
  'run.app',
  'cloudfunctions.net',
  'appspot.com',
  'web.app',
  'firebaseapp.com',
  'k8s.io',
  'kubernetes.io',
  'gke.io',
  'knative.dev',
  'githubusercontent.com',
  // Hosts the managed services hand out: API Gateway, Secure Source Manager, Developer Connect,
  // Looker (Google Cloud core), Blockchain Node Engine, and Cloud Run domain mappings' DNS targets. Listed
  // as narrowly as the services use them: `ghs.googlehosted.com`, not every googlehosted.com host.
  'gateway.dev',
  'sourcemanager.dev',
  'developerconnect.dev',
  'looker.app',
  'blockchainnodeengine.com',
  'domains.cloudrun.com',
  'ghs.googlehosted.com',
];

/** Synthetic project ids: `demo-` and at least one more character. */
export const SYNTHETIC_PROJECT_ID = /^demo-[a-z0-9-]+$/;

/**
 * Project ids Google owns, which real resources legitimately reference: public image projects
 * (`debian-cloud`, `cos-cloud`, `gke-node-images`, …) and service producers' tenant projects (`<hex>-tp`).
 */
const PLATFORM_PROJECT_ID =
  /^(?:[a-z][a-z0-9-]*-cloud|[a-z0-9]+-tp|gke-node-images|serverless-vpc-access-images|cloud-hpc-image-public|deeplearning-platform-release|ml-images|gce-uefi-images)$/;

/** The synthetic organisations: the demo organisations S, M, L and XL (each its own). */
export const SYNTHETIC_ORGANIZATION_IDS: readonly string[] = [
  '30000000001',
  '30000000002',
  '30000000003',
  '30000000004',
];

export const SYNTHETIC_IPV4_RANGES: readonly string[] = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '169.254.0.0/16',
  '127.0.0.0/8',
  '192.0.2.0/24',
  '198.51.100.0/24',
  '203.0.113.0/24',
  // Shared address space (RFC 6598): Cloud Composer 3's default internal range and other carrier-grade NAT
  // ranges, never a customer's public address.
  '100.64.0.0/10',
  '0.0.0.0/32',
];

/**
 * Top-level domains that make a dotted token a host name. Deliberately excludes TLDs that collide with file
 * extensions (`.py`, `.sh`, `.md`, `.rs`, …) so source paths do not trip the sweep.
 */
const PUBLIC_TLDS = new Set([
  'com',
  'net',
  'org',
  'io',
  'dev',
  'app',
  'cloud',
  'ai',
  'co',
  'info',
  'biz',
  'me',
  'us',
  'uk',
  'de',
  'fr',
  'eu',
  'ch',
  'nl',
  'se',
  'no',
  'dk',
  'fi',
  'it',
  'es',
  'at',
  'be',
  'pl',
  'jp',
  'cn',
  'br',
  'au',
  'ca',
  'tech',
  'online',
  'site',
  'xyz',
  'gov',
  'edu',
  'int',
  'mil',
  'shop',
  'store',
  'cz',
  'pt',
  'ie',
  'nz',
  'sg',
  'hk',
  'kr',
  'mx',
  'ar',
]);

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
/** A dotted host name; a token followed by `(` is a method call in source code (`list.at(-1)`), not a host. */
const HOST =
  /(?<![A-Za-z0-9_-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+([A-Za-z]{2,24})(?![A-Za-z0-9(-])/g;
const PROJECT_NUMBER =
  /\bprojects\/(\d+)(?!\d)|"projectNumber"\s*:\s*"?(\d+)|\bservice-(\d+)@|\b(\d+)-compute@|\b(\d+)@cloud(?:services|build)\.gserviceaccount\.com/g;
/** A project number in a Cloud Run host: `https://<service>-<number>.<region>.run.app`. */
const RUN_APP_NUMBER = /\b[a-z0-9-]*?-(\d{6,})\.[a-z0-9-]+\.run\.app\b/gi;
const FOLDER_NUMBER = /\bfolders\/(\d+)(?!\d)/g;
const ORGANIZATION_ID = /\borganizations\/(\d+)(?!\d)|"organizationId"\s*:\s*"?(\d+)/g;
/** A Resource Manager v1 parent, `{ "type": "folder", "id": "N" }`, in either key order. */
const V1_PARENT =
  /"type"\s*:\s*"(organization|folder|project)"\s*,\s*"id"\s*:\s*"(\d+)"|"id"\s*:\s*"(\d+)"\s*,\s*"type"\s*:\s*"(organization|folder|project)"/g;
/** A project id in a self-link (`…googleapis.com/<api>/<version>/projects/<id>`) or full name (`//<service>/projects/<id>`). */
const NAMED_PROJECT_ID =
  /(?:googleapis\.com\/[a-z]+\/(?:v[0-9]+|beta|alpha)[a-z0-9]*|\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)+)\/projects\/([a-z0-9.:-]+)/g;
const PROJECT_ID_FIELD = /"projectId"\s*:\s*"([^"\\]*)"/g;
/** A project id as Resource Manager allows it: 6 to 30 characters, a letter first. */
const PROJECT_ID_SHAPE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const IPV4 = /(?<![\d.])(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?(?![\d.])/g;
const IPV6 =
  /(?<![0-9A-Fa-f:])((?:[0-9A-Fa-f]{1,4}:){1,7}:?(?:[0-9A-Fa-f]{1,4})?(?::[0-9A-Fa-f]{1,4})*)(?:\/(\d{1,3}))?(?![0-9A-Fa-f:])/g;

function underDomain(host: string, domains: readonly string[]): boolean {
  const lower = host.toLowerCase();
  return domains.some((d) => lower === d || lower.endsWith(`.${d}`));
}

function ipv4ToInt(a: number, b: number, c: number, d: number): number {
  return ((a << 24) >>> 0) + (b << 16) + (c << 8) + d;
}

function cidrBounds(cidr: string): readonly [number, number] {
  const [ip = '', prefixText = '32'] = cidr.split('/');
  const parts = ip.split('.').map(Number);
  const base = ipv4ToInt(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0);
  const size = 2 ** (32 - Number(prefixText));
  const start = base - (base % size);
  return [start, start + size - 1];
}

/** Expands an IPv6 address to eight 16-bit groups, or `undefined` when it is not one. */
function ipv6Groups(text: string): number[] | undefined {
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const parse = (part: string): number[] => (part === '' ? [] : part.split(':').map((g) => parseInt(g, 16)));
  const head = parse(halves[0] ?? '');
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if ([...head, ...tail].some((g) => Number.isNaN(g) || g > 0xffff)) return undefined;
  if (halves.length === 1) return head.length === 8 ? head : undefined;
  const missing = 8 - head.length - tail.length;
  return missing < 1 ? undefined : [...head, ...Array.from({ length: missing }, () => 0), ...tail];
}

function syntheticIpv6(groups: readonly number[]): boolean {
  const first = groups[0] ?? 0;
  const second = groups[1] ?? 0;
  if (groups.every((g) => g === 0)) return true; // :: and ::/0
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1
  if (first === 0x2001 && second === 0x0db8) return true; // documentation
  if ((first & 0xfe00) === 0xfc00) return true; // unique local
  return (first & 0xffc0) === 0xfe80; // link-local
}

/** 1-based line numbers of string offsets, by binary search over the line starts. */
function lineIndex(text: string): (index: number) => number {
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  return (index) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((lineStarts[mid] ?? 0) <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/** Every match in `text` that does not look synthetic, by line. */
export function findNonSyntheticData(text: string, options: SyntheticGuardOptions = {}): SyntheticFinding[] {
  const exampleDomains = options.exampleDomains ?? EXAMPLE_DOMAINS;
  const platformDomains = options.platformDomains ?? PLATFORM_DOMAINS;
  const projectIdPattern = options.projectIdPattern ?? SYNTHETIC_PROJECT_ID;
  const limit = options.numberLimit ?? 100_000_000_000;
  const organizations = options.organizationIds ?? SYNTHETIC_ORGANIZATION_IDS;
  const ranges = (options.allowedIpv4Ranges ?? SYNTHETIC_IPV4_RANGES).map(cidrBounds);

  const lineOf = lineIndex(text);
  const findings: SyntheticFinding[] = [];
  const report = (kind: SyntheticFindingKind, value: string, index: number): void => {
    findings.push({ kind, value, line: lineOf(index) });
  };
  const tooBig = (digits: string | undefined): boolean => digits !== undefined && Number(digits) >= limit;
  const syntheticProjectId = (id: string): boolean =>
    projectIdPattern.test(id) || PLATFORM_PROJECT_ID.test(id);

  // E-mail addresses first; they are masked (in one pass) so their domains are not judged again as hosts.
  const pieces: string[] = [];
  let copied = 0;
  for (const match of text.matchAll(EMAIL)) {
    const [address] = match;
    const domain = (match[1] ?? '').toLowerCase();
    const local = address.slice(0, address.indexOf('@'));
    let ok = underDomain(domain, exampleDomains);
    if (!ok && underDomain(domain, ['gserviceaccount.com'])) {
      const numbers = local.match(/\d{6,}/g) ?? [];
      const numbersOk = numbers.every((n) => Number(n) < limit);
      const projectLabel = domain.endsWith('.iam.gserviceaccount.com')
        ? domain.slice(0, -'.iam.gserviceaccount.com'.length)
        : undefined;
      if (projectLabel !== undefined && !projectLabel.startsWith('gcp-sa-'))
        ok = numbersOk && projectIdPattern.test(projectLabel);
      else if (domain === 'appspot.gserviceaccount.com') ok = numbersOk && projectIdPattern.test(local);
      else ok = numbersOk;
    }
    if (!ok) report('email', address, match.index);
    pieces.push(text.slice(copied, match.index), ' '.repeat(address.length));
    copied = match.index + address.length;
  }
  pieces.push(text.slice(copied));
  const masked = pieces.join('');

  for (const match of masked.matchAll(HOST)) {
    const [host] = match;
    const tld = (match[1] ?? '').toLowerCase();
    if (!PUBLIC_TLDS.has(tld)) continue;
    if (underDomain(host, exampleDomains) || underDomain(host, platformDomains)) continue;
    report('domain', host, match.index);
  }
  for (const match of text.matchAll(PROJECT_NUMBER)) {
    const digits = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
    if (tooBig(digits)) report('project-number', match[0], match.index);
  }
  for (const match of text.matchAll(RUN_APP_NUMBER)) {
    if (tooBig(match[1])) report('project-number', match[0], match.index);
  }
  for (const match of text.matchAll(FOLDER_NUMBER)) {
    if (tooBig(match[1])) report('folder-number', match[0], match.index);
  }
  for (const match of text.matchAll(ORGANIZATION_ID)) {
    if (!organizations.includes(match[1] ?? match[2] ?? '')) report('organization-id', match[0], match.index);
  }
  for (const match of text.matchAll(V1_PARENT)) {
    const type = match[1] ?? match[4] ?? '';
    const id = match[2] ?? match[3] ?? '';
    if (type === 'organization') {
      if (!organizations.includes(id)) report('organization-id', match[0], match.index);
    } else if (tooBig(id)) {
      report(type === 'folder' ? 'folder-number' : 'project-number', match[0], match.index);
    }
  }
  const checkProjectId = (ref: string, value: string, index: number): void => {
    const id = ref.slice(ref.lastIndexOf(':') + 1);
    if (PROJECT_ID_SHAPE.test(id) && !syntheticProjectId(id)) report('project-id', value, index);
  };
  for (const match of text.matchAll(NAMED_PROJECT_ID)) checkProjectId(match[1] ?? '', match[0], match.index);
  for (const match of text.matchAll(PROJECT_ID_FIELD)) checkProjectId(match[1] ?? '', match[0], match.index);
  for (const match of text.matchAll(IPV4)) {
    const octets = [match[1], match[2], match[3], match[4]].map(Number);
    if (octets.some((o) => o > 255)) continue;
    const prefix = match[5] === undefined ? 32 : Number(match[5]);
    if (prefix > 32) continue;
    const start = ipv4ToInt(octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0);
    if (start === 0 && prefix === 0) continue; // 0.0.0.0/0, the default route
    const size = 2 ** (32 - prefix);
    const first = start - (start % size);
    const last = first + size - 1;
    if (!ranges.some(([lo, hi]) => first >= lo && last <= hi)) report('ip', match[0], match.index);
  }
  for (const match of text.matchAll(IPV6)) {
    const candidate = match[1] ?? '';
    if (!candidate.includes('::') && candidate.split(':').length !== 8) continue;
    if (!/[0-9A-Fa-f]/.test(candidate.replaceAll(':', '')) && candidate !== '::') continue;
    const groups = ipv6Groups(candidate);
    if (groups === undefined) continue;
    if (!syntheticIpv6(groups)) report('ip', match[0], match.index);
  }
  return findings.sort((a, b) => a.line - b.line);
}

/** One line per finding, at most `max` of them, then how many more there are. */
export function formatSyntheticFindings(findings: readonly SyntheticFinding[], max = 20): string[] {
  const lines = findings.slice(0, max).map((f) => `line ${String(f.line)}: ${f.kind} ${f.value}`);
  if (findings.length > max) lines.push(`… and ${String(findings.length - max)} more`);
  return lines;
}

/** Throws with every finding listed when `text` holds anything that does not look synthetic. */
export function assertSyntheticOnly(text: string, options?: SyntheticGuardOptions, label = 'input'): void {
  const findings = findNonSyntheticData(text, options);
  if (findings.length === 0) return;
  const shown = formatSyntheticFindings(findings)
    .map((line) => `  ${line}`)
    .join('\n');
  throw new Error(`${label} contains data that does not look synthetic:\n${shown}`);
}
