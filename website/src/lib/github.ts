// SPDX-License-Identifier: Apache-2.0
/**
 * The repository's facts for the header's repository widget (the latest release's version, the star count and the
 * fork count), read from GitHub's REST API when the site is built and written into the pages as text: the first layer
 * of the widget (src/lib/star-count.ts describes both). The facts are there at first paint, so nothing moves when a
 * page is shown; once the page has loaded, the visitor's browser asks GitHub for the current ones and replaces them
 * (src/lib/star-count-page.ts). The build's facts are as fresh as the last build (the website workflow rebuilds daily
 * once the deploy is switched on: its scheduled run is skipped until PAGES_DEPLOY is true).
 *
 * Two requests, made together: the repository (`stargazers_count`, `forks_count`) and its latest release (`tag_name`).
 * The build never fails over them. A problem with the repository's answer prints one warning line, and the header shows
 * the link without facts: a repository URL that is not a github.com repository (a fork's own host), offline, no answer
 * within 3 s, a 404 (the repository is private, or not there yet), an answer saying it is private (to a token that may
 * read it), a 403 or 429 (the rate limit is spent), or a body without the counts. The 404 and the private answer also
 * say that the repository is not public (`notPublic`): a visitor's browser, asking anonymously, would get the same 404,
 * so the header tells the page's script not to ask at all (`data-repository-not-public`, src/components/Header.astro);
 * a site built while the repository is not public shows no live facts until the next build after it is (pages.yml
 * rebuilds daily). The release's answer only decides the version: a 404 is a repository without a release yet (no
 * version, no line), any other problem prints one warning line and leaves the version out. With `GITHUB_TOKEN` set
 * (GitHub Actions provides one) the requests are authenticated, which lifts the unauthenticated limit of 60 requests an
 * hour per address; the token is sent to api.github.com only and never printed. Nothing is cached on disk: a build asks
 * once and keeps the answer in memory for every page.
 *
 * `WEBSITE_STAR_COUNT` replaces the build's requests, for previews, tests and builds without a network: a whole number
 * is used as the star count, with `WEBSITE_FORK_COUNT` as the fork count (0 when unset) and `WEBSITE_RELEASE` as the
 * latest release's tag (none when unset); `off` shows no facts. Neither asks GitHub at build time; the visitor's
 * browser still does.
 */
import { REPOSITORY_URL } from '../site.js';
import { isCount, isReleaseTag, isRepositorySlug, type RepositoryFacts } from './star-count.js';

// The formatter and the link's name are shared with the visitor's browser (src/lib/star-count.ts).
export { formatCount, repositoryLinkLabel } from './star-count.js';

export const FACTS_TIMEOUT_MS = 3000;
export const GITHUB_API = 'https://api.github.com';

export type Repository = { readonly owner: string; readonly name: string };

/** The owner and name of a github.com repository URL ("https://github.com/owner/name"). */
export function repositoryOf(url: string): Repository {
  const parsed = new URL(url);
  const segments = parsed.pathname
    .replace(/\.git$/, '')
    .split('/')
    .filter((segment) => segment !== '');
  const [owner, name] = segments;
  if (
    parsed.hostname !== 'github.com' ||
    segments.length !== 2 ||
    owner === undefined ||
    name === undefined
  ) {
    throw new Error(`not a github.com repository URL: ${url}`);
  }
  return { owner, name };
}

/**
 * "owner/name" of a github.com repository URL, for the header link's `data-repository` (what the visitor's browser
 * asks GitHub about), or undefined when the URL is not a github.com repository or not a name GitHub allows (then the
 * browser asks nothing).
 */
export function repositorySlug(url: string): string | undefined {
  let slug: string;
  try {
    const { owner, name } = repositoryOf(url);
    slug = `${owner}/${name}`;
  } catch {
    return undefined;
  }
  return isRepositorySlug(slug) ? slug : undefined;
}

/**
 * What the build's requests learned: the facts (null when there are none to show), and whether GitHub said the
 * repository is not public (a 404, or an answer marked private), in which case the visitor's browser is not asked to
 * try (src/lib/star-count-page.ts).
 */
export type BuildFacts = { readonly facts: RepositoryFacts | null; readonly notPublic: boolean };

const NO_FACTS: BuildFacts = Object.freeze({ facts: null, notPublic: false });
const NOT_PUBLIC: BuildFacts = Object.freeze({ facts: null, notPublic: true });

export type FactsOptions = {
  /** The fetch to use (tests pass a mock); the global one by default. */
  readonly fetch?: typeof fetch;
  /** Sent as `Authorization: Bearer …` when set and not empty. */
  readonly token?: string | undefined;
  readonly timeoutMs?: number;
  /** Where the warning lines go; console.warn by default. */
  readonly warn?: (message: string) => void;
};

const PREFIX = 'website: GitHub repository widget:';
const OUTCOME = "the header's GitHub link shows no stars, forks or version.";
const OUTCOME_NOT_PUBLIC =
  "the header's GitHub link shows no stars, forks or version, and visitors' browsers will not ask GitHub for them.";
const OUTCOME_VERSION = "the header's GitHub link shows no version.";

function warnOf(options: FactsOptions): (message: string) => void {
  return (
    options.warn ??
    ((message: string): void => {
      console.warn(message);
    })
  );
}

/** One answer of the API: its status and JSON body (undefined when it is not a JSON object), or why there is none. */
type Reply =
  | {
      readonly status: number;
      readonly remaining: string | null;
      readonly body: Record<string, unknown> | undefined;
    }
  | { readonly failure: string };

/** One GET of GitHub's API at `apiPath`, given up after the timeout. It never rejects. */
async function askGitHub(apiPath: string, options: FactsOptions): Promise<Reply> {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? FACTS_TIMEOUT_MS;
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'gcportrait-website-build',
  };
  if (options.token !== undefined && options.token !== '') headers.Authorization = `Bearer ${options.token}`;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      resolve('timeout'); // first, so the race is decided before the aborted request rejects
      controller.abort();
    }, timeoutMs);
  });
  const request = (async (): Promise<Reply> => {
    const response = await fetchImpl(`${GITHUB_API}${apiPath}`, { headers, signal: controller.signal });
    const remaining = response.headers.get('x-ratelimit-remaining');
    if (response.status !== 200) return { status: response.status, remaining, body: undefined };
    const body: unknown = await response.json().catch(() => undefined); // not JSON: no facts, below
    return {
      status: 200,
      remaining,
      body:
        typeof body === 'object' && body !== null && !Array.isArray(body)
          ? (body as Record<string, unknown>)
          : undefined,
    };
  })();
  try {
    const outcome = await Promise.race([request, timedOut]);
    if (outcome === 'timeout')
      return { failure: `no answer from ${GITHUB_API} within ${String(timeoutMs / 1000)} s` };
    return outcome;
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.cause instanceof Error
          ? error.cause.message
          : error.message
        : String(error);
    return { failure: `could not reach ${GITHUB_API} (${reason})` };
  } finally {
    clearTimeout(timer);
  }
}

/** Why GitHub's answer with `status` (not 200) gives nothing, in a warning line's words. */
function refusal(status: number, remaining: string | null): string {
  const limited = status === 403 || status === 429;
  return status === 404
    ? 'not found or not public yet'
    : status === 401
      ? 'GITHUB_TOKEN refused'
      : limited && remaining === '0'
        ? 'rate limit spent; set GITHUB_TOKEN'
        : limited
          ? 'refused or rate-limited; set GITHUB_TOKEN'
          : 'unexpected status';
}

/**
 * Asks GitHub for a repository's facts (both requests together), and says whether GitHub answered that the
 * repository is not public (a 404, or an answer marked private). Prints one warning line for a problem with the
 * repository's answer, and one for a problem with the release's other than a 404 (no release yet). It never rejects.
 */
export async function askRepositoryFacts(
  repository: Repository,
  options: FactsOptions = {},
): Promise<BuildFacts> {
  const warn = warnOf(options);
  const slug = `${repository.owner}/${repository.name}`;
  const base = `/repos/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.name)}`;
  const [counts, release] = await Promise.all([
    askGitHub(base, options),
    askGitHub(`${base}/releases/latest`, options),
  ]);
  if ('failure' in counts) {
    warn(`${PREFIX} ${counts.failure}; ${OUTCOME}`);
    return NO_FACTS;
  }
  if (counts.status !== 200) {
    const notPublic = counts.status === 404;
    warn(
      `${PREFIX} GitHub answered ${String(counts.status)} for ${slug} (${refusal(counts.status, counts.remaining)}); ${notPublic ? OUTCOME_NOT_PUBLIC : OUTCOME}`,
    );
    return notPublic ? NOT_PUBLIC : NO_FACTS;
  }
  const fields = counts.body ?? {};
  // A token that may read a private repository (the workflow's own) gets an answer; visitors would not.
  if (fields.private === true) {
    warn(`${PREFIX} ${slug} is private; ${OUTCOME_NOT_PUBLIC}`);
    return NOT_PUBLIC;
  }
  const { stargazers_count: stars, forks_count: forks } = fields;
  if (!isCount(stars) || !isCount(forks)) {
    warn(`${PREFIX} GitHub's answer for ${slug} has no stargazers_count and forks_count; ${OUTCOME}`);
    return NO_FACTS;
  }
  let version: string | null = null;
  if ('failure' in release) {
    warn(`${PREFIX} the latest release of ${slug}: ${release.failure}; ${OUTCOME_VERSION}`);
  } else if (release.status === 200) {
    const tag = release.body?.tag_name;
    if (isReleaseTag(tag)) version = tag;
    else warn(`${PREFIX} GitHub's latest release of ${slug} has no tag_name to show; ${OUTCOME_VERSION}`);
  } else if (release.status !== 404) {
    warn(
      `${PREFIX} GitHub answered ${String(release.status)} for the latest release of ${slug} (${refusal(release.status, release.remaining)}); ${OUTCOME_VERSION}`,
    );
  }
  return { facts: { version, stars, forks }, notPublic: false };
}

/** The build's settings for the facts: the overrides and the token (process.env in a build). */
export type FactsEnv = {
  readonly WEBSITE_STAR_COUNT?: string | undefined;
  readonly WEBSITE_FORK_COUNT?: string | undefined;
  readonly WEBSITE_RELEASE?: string | undefined;
  readonly GITHUB_TOKEN?: string | undefined;
};

/** A whole number as an environment variable writes it, or undefined. */
function wholeNumber(value: string): number | undefined {
  return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined;
}

/**
 * The overrides: undefined when `WEBSITE_STAR_COUNT` is unset or empty (ask GitHub); null for `off` (no facts); or the
 * facts, the stars from `WEBSITE_STAR_COUNT`, the forks from `WEBSITE_FORK_COUNT` (0 when unset) and the version from
 * `WEBSITE_RELEASE` (none when unset). A value that is not what it should be is refused with a warning: in
 * `WEBSITE_STAR_COUNT` it shows no facts, so a typo neither fails the build nor asks GitHub when the builder meant not
 * to; in the other two it gives that fact's default.
 */
export function factsOverride(
  env: FactsEnv,
  warn: (message: string) => void = (message) => {
    console.warn(message);
  },
): RepositoryFacts | null | undefined {
  const starsText = env.WEBSITE_STAR_COUNT?.trim() ?? '';
  if (starsText === '') return undefined;
  if (starsText === 'off') return null;
  const stars = wholeNumber(starsText);
  if (stars === undefined) {
    warn(`${PREFIX} WEBSITE_STAR_COUNT is "${starsText}", not a whole number or "off"; ${OUTCOME}`);
    return null;
  }
  const forksText = env.WEBSITE_FORK_COUNT?.trim() ?? '';
  let forks = forksText === '' ? 0 : wholeNumber(forksText);
  if (forks === undefined) {
    warn(`${PREFIX} WEBSITE_FORK_COUNT is "${forksText}", not a whole number; the header shows 0 forks.`);
    forks = 0;
  }
  const tag = env.WEBSITE_RELEASE?.trim() ?? '';
  let version: string | null = tag === '' ? null : tag;
  if (version !== null && !isReleaseTag(version)) {
    warn(`${PREFIX} WEBSITE_RELEASE is "${tag}", not a release tag; ${OUTCOME_VERSION}`);
    version = null;
  }
  return { version, stars, forks };
}

/**
 * What the build knows about the facts of the repository at `url`: the overrides (which never say "not public": they ask
 * GitHub nothing), else GitHub's answers. Resolves to no facts after one warning line on any problem with the
 * repository, a URL that is not a github.com repository included; it never rejects.
 */
export async function buildRepositoryFactsOf(
  url: string,
  env: FactsEnv,
  options: Omit<FactsOptions, 'token'> = {},
): Promise<BuildFacts> {
  const warn = warnOf(options);
  try {
    const override = factsOverride(env, warn);
    if (override !== undefined) return { facts: override, notPublic: false };
    let repository: Repository;
    try {
      repository = repositoryOf(url);
    } catch (error) {
      warn(`${PREFIX} ${error instanceof Error ? error.message : String(error)}; ${OUTCOME}`);
      return NO_FACTS;
    }
    return await askRepositoryFacts(repository, { ...options, warn, token: env.GITHUB_TOKEN });
  } catch (error) {
    warn(`${PREFIX} ${error instanceof Error ? error.message : String(error)}; ${OUTCOME}`);
    return NO_FACTS;
  }
}

let pending: Promise<BuildFacts> | undefined;

/** What this build knows about REPOSITORY_URL's facts: asked once, then shared by every page. */
export function repositoryFacts(): Promise<BuildFacts> {
  pending ??= buildRepositoryFactsOf(REPOSITORY_URL, process.env);
  return pending;
}
