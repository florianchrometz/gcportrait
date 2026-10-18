// SPDX-License-Identifier: Apache-2.0
/**
 * The header's repository widget, the parts the build and the visitor's browser share (docs/website.md, "GitHub
 * repository widget"). The widget is the header's link to the repository on GitHub, and it shows three facts of it:
 * the latest release's version, the star count and the fork count. They have two layers:
 *
 * 1. The build reads them from GitHub's REST API (src/lib/github.ts) and writes them into every page as text, so the
 *    facts are there at first paint and nothing moves when the page is shown.
 * 2. Once the page has loaded, the visitor's browser asks GitHub for the current ones (src/lib/star-count-page.ts,
 *    with `liveRepositoryFacts` below): the repository (its stars and forks) and its latest release (the version), two
 *    requests made together. They are anonymous: no credentials, no cookies, no referrer. On any failure the build's
 *    facts (or none) simply stay. The browser asks at most once an hour per tab, whatever the answer: it notes in
 *    sessionStorage that it asked before it asks, then keeps the facts there for the hour (or the note alone after a
 *    failure). Where sessionStorage is blocked it does not ask at all, nor where the build's own request found the
 *    repository not public (GitHub's 404: the header link's `data-repository-not-public`).
 *
 * Both layers abbreviate the counts with `formatCount` and name the link with `repositoryLinkLabel`, so the browser
 * writes exactly what the build would have. Nothing here logs: a visitor's data is never printed.
 */

/**
 * Where a visitor's browser keeps, for the session (sessionStorage), when it last asked GitHub and the facts it got,
 * if any.
 */
export const FACTS_STORAGE_KEY = 'gcportrait.repository';
/** How long the browser waits after asking GitHub before it asks again (facts, or none, are kept that long): an hour. */
export const FACTS_MAX_AGE_MS = 60 * 60 * 1000;
/** How long the browser waits for GitHub's answers, bodies included. */
export const FACTS_LIVE_TIMEOUT_MS = 4000;

/**
 * What the widget shows of the repository: its stars and forks (the repository's answer gives both or neither), and
 * the tag of its latest release ("v1.0.0"), null where there is none or it is not known.
 */
export type RepositoryFacts = {
  readonly version: string | null;
  readonly stars: number;
  readonly forks: number;
};

/** A count GitHub could send: a whole number, not negative. */
export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * A release tag the widget may show as it is: up to 40 letters, digits, ".", "_", "+" and "-", starting with a letter or
 * a digit ("v1.0.0", "2026.10.1"). Anything else is not shown, so no answer can put markup or a long text into the
 * header.
 */
export function isReleaseTag(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$/.test(value);
}

/**
 * A count as GitHub abbreviates it on a repository's star and fork buttons: exact below 1000, then thousands with one
 * decimal, rounded, and a trailing ".0" dropped (999, 1k, 1.2k, 12k, 12.3k, 63.2k for 63,156, 456.8k, 1.2M), as
 * GitHub's own pages show them (83,280 stars read "83.3k", 63,156 read "63.2k").
 */
export function formatCount(count: number): string {
  const whole = Math.max(0, Math.round(count));
  if (whole < 1000) return String(whole);
  const withTenths = (tenths: number, suffix: string): string =>
    `${String(Math.floor(tenths / 10))}${tenths % 10 === 0 ? '' : `.${String(tenths % 10)}`}${suffix}`;
  const thousandTenths = Math.round(whole / 100);
  if (thousandTenths < 10_000) return withTenths(thousandTenths, 'k');
  return withTenths(Math.round(whole / 100_000), 'M');
}

/** A release tag as the link's name reads it: "v1.0.0" is version "1.0.0"; a tag of another form stays as it is. */
export function versionName(tag: string): string {
  return /^v\d/i.test(tag) ? tag.slice(1) : tag;
}

/**
 * The link's accessible name: "gcportrait on GitHub: version 1.0.0, 1.2k stars, 3 forks" (singular for one; the version
 * left out where there is none), or "gcportrait on GitHub" without facts.
 */
export function repositoryLinkLabel(product: string, facts: RepositoryFacts | null): string {
  if (facts === null) return `${product} on GitHub`;
  const parts = [
    ...(facts.version === null ? [] : [`version ${versionName(facts.version)}`]),
    `${formatCount(facts.stars)} ${facts.stars === 1 ? 'star' : 'stars'}`,
    `${formatCount(facts.forks)} ${facts.forks === 1 ? 'fork' : 'forks'}`,
  ];
  return `${product} on GitHub: ${parts.join(', ')}`;
}

/**
 * Whether a text is a repository as GitHub names it, "owner/name" (an owner of letters, digits and hyphens, up to 39;
 * a name of letters, digits, ".", "_" and "-", never "." or ".."): the only thing the browser puts into its requests.
 */
export function isRepositorySlug(value: string): boolean {
  const match = /^[A-Za-z0-9-]{1,39}\/([A-Za-z0-9._-]{1,100})$/.exec(value);
  return match !== null && match[1] !== '.' && match[1] !== '..';
}

/** Facts as GitHub's answers give them, or null when they are not facts the widget can show. */
export function factsOf(value: unknown): RepositoryFacts | null {
  if (typeof value !== 'object' || value === null) return null;
  const { version, stars, forks } = value as Record<string, unknown>;
  if (!isCount(stars) || !isCount(forks) || (version !== null && !isReleaseTag(version))) return null;
  return { version, stars, forks };
}

/**
 * What the browser keeps in sessionStorage, `at` in milliseconds: `{"facts":null,"at":1791720000000}` just before it
 * asks GitHub (and so after a failure, which leaves it), `{"facts":{"version":"v1.0.0","stars":12,"forks":3},"at":…}`
 * once GitHub has answered with facts.
 */
export function keptFactsText(facts: RepositoryFacts | null, now: number): string {
  return JSON.stringify({
    facts: facts === null ? null : { version: facts.version, stars: facts.stars, forks: facts.forks },
    at: now,
  });
}

/**
 * What sessionStorage says (`text` as read, null when there is nothing), if it was written less than an hour before
 * `now`: the facts GitHub gave, or null where the browser asked within the hour and got none (a failure, or an answer
 * still on its way). Either way the browser does not ask again. Undefined, so the browser may ask, when there is
 * nothing, it is an hour old or older, it is dated in the future, or it is not what keptFactsText writes.
 */
export function keptFacts(text: string | null, now: number): RepositoryFacts | null | undefined {
  if (text === null) return undefined;
  let kept: unknown;
  try {
    kept = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof kept !== 'object' || kept === null) return undefined;
  const { facts, at } = kept as Record<string, unknown>;
  if (typeof at !== 'number' || at > now || now - at >= FACTS_MAX_AGE_MS) return undefined;
  if (facts === null) return null;
  return factsOf(facts) ?? undefined;
}

/** The JSON body of a 200 answer, or undefined for any other status or a body that is not a JSON object. */
async function answerBody(response: Response): Promise<Record<string, unknown> | undefined> {
  if (response.status !== 200) return undefined;
  const body: unknown = await response.json();
  return typeof body === 'object' && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : undefined;
}

/**
 * Asks GitHub for a repository's facts from the visitor's browser: two GETs to api.github.com made together, the
 * repository (stargazers_count and forks_count) and its latest release (tag_name), each accepting GitHub's JSON, with
 * no credentials (so no cookies), no referrer and no header that would need a CORS preflight, both given up after
 * `timeoutMs`. Resolves to the facts, the version null when the release's answer gives none (no release yet, or any
 * failure of that request); or to undefined when the repository's answer gives no counts (a 403, 404 or 429, another
 * status, a body without them, offline, the timeout). It never rejects and never logs.
 */
export async function liveRepositoryFacts(
  slug: string,
  timeoutMs: number = FACTS_LIVE_TIMEOUT_MS,
): Promise<RepositoryFacts | undefined> {
  if (!isRepositorySlug(slug)) return undefined;
  const signal = AbortSignal.timeout(timeoutMs);
  // The site's requests to another host; `pnpm website:check` allows exactly these addresses in a script, each with
  // its options written out and credentials: 'omit'.
  const repository = fetch(`https://api.github.com/repos/${slug}`, {
    headers: { Accept: 'application/vnd.github+json' },
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal,
  })
    .then(answerBody)
    .catch(() => undefined);
  const release = fetch(`https://api.github.com/repos/${slug}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    signal,
  })
    .then(answerBody)
    .catch(() => undefined);
  const [counts, latest] = await Promise.all([repository, release]);
  if (counts === undefined) return undefined;
  const { stargazers_count: stars, forks_count: forks } = counts;
  if (!isCount(stars) || !isCount(forks)) return undefined;
  const tag = latest?.tag_name;
  return { version: isReleaseTag(tag) ? tag : null, stars, forks };
}

/** The part of sessionStorage the widget uses. */
export type FactStore = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The facts the header should show in the visitor's browser, asking GitHub at most once an hour (see the module
 * comment): the facts kept within the hour; or, when nothing is kept within the hour, GitHub's answer, asked after
 * noting the request in the store, and kept there when it gives facts. Undefined when there are none to show: the
 * browser asked within the hour and got none, GitHub gave none now, or the store is blocked (`store` throws, or its
 * `setItem` does), in which case GitHub is not asked at all, since the browser could not remember having asked.
 * `ask` and `now` are GitHub and the clock, replaceable in tests.
 */
export async function currentRepositoryFacts(
  slug: string,
  store: () => FactStore,
  ask: (slug: string) => Promise<RepositoryFacts | undefined> = liveRepositoryFacts,
  now: () => number = Date.now,
): Promise<RepositoryFacts | undefined> {
  let text: string | null = null;
  try {
    text = store().getItem(FACTS_STORAGE_KEY);
  } catch {
    // Blocked: nothing kept, and the note below fails too.
  }
  const kept = keptFacts(text, now());
  if (kept !== undefined) return kept ?? undefined;
  const keep = (facts: RepositoryFacts | null): boolean => {
    try {
      store().setItem(FACTS_STORAGE_KEY, keptFactsText(facts, now()));
      return true;
    } catch {
      return false;
    }
  };
  if (!keep(null)) return undefined;
  const live = await ask(slug);
  if (live !== undefined) keep(live);
  return live;
}
