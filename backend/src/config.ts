// SPDX-License-Identifier: MIT
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RENDER_MAX_PIXELS } from '@gcportrait/model';

import * as z from 'zod';

import { LegalTextError, NO_LEGAL_TEXTS, parseLegalBundle, readLegalDir, type LegalTexts } from './legal.js';

/**
 * Service configuration, read once from the environment at start-up (docs/configuration.md).
 * Every variable is documented in backend/.env.example. Nothing here is a secret: the OAuth client id and
 * the service-account email are public by design, and the backend never holds a credential of its own on disk.
 */

/** The backend package root: the parent of src/ (tsx in development) and of dist/ (the bundles). */
const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url));

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_FORMATS = ['json', 'pretty'] as const;
export type LogFormat = (typeof LOG_FORMATS)[number];

export type ServerConfig = {
  /** TCP port to listen on (Cloud Run sets PORT). */
  readonly port: number;
  /** Interface to bind; 0.0.0.0 in a container, `localhost` for local development. */
  readonly host: string;
  readonly logLevel: LogLevel;
  /** `json` for Cloud Logging, `pretty` for a terminal (needs the pino-pretty dev dependency). */
  readonly logFormat: LogFormat;
  /** Public Google OAuth web client id used by the SPA for sign-in, or null when sign-in is not configured. */
  readonly oauthClientId: string | null;
  /** Whether the operator enabled service-account mode (AGENTS.md, Modes and hosting). */
  readonly saModeEnabled: boolean;
  /**
   * Whether the service-account gate also runs its optional exposure check (backend/AGENTS.md, The service-account gate): the account's own `get` of a scope must be refused, so a scope whose details
   * are public, or on which the account holds more than `roles/cloudasset.viewer`, is refused. On with
   * `SA_MODE_STRICT_EXPOSURE=true`, off when it is `false` or unset; any other value stops start-up
   * ({@link parseConfig}).
   */
  readonly saStrictExposure: boolean;
  /**
   * The backend service account email customers grant `roles/cloudasset.viewer` to, or null. With service-account
   * mode on, it must be the account Application Default Credentials resolve to (auth/mode.ts), which fills it
   * in when `BACKEND_SA_EMAIL` is unset.
   */
  readonly backendServiceAccount: string | null;
  /**
   * Who runs this instance (a person or an organisation), shown before sign-in as "Hosted by …" (`hostedBy` in
   * /api/config); null when the operator gives no name.
   */
  readonly hostedBy: string | null;
  /** Absolute path of the built SPA. Served only when it holds an index.html (production image). */
  readonly staticDir: string;
  /** Reverse-proxy hops to trust for the client address (1 on Cloud Run, 0 when reached directly). */
  readonly trustProxyHops: number;
  /** Version reported by /healthz and /api/config. */
  readonly version: string;
  /**
   * Where the source of the running version is published: the app's footer links to it as "Source (MIT)" on every
   * route, a courtesy to the people who use the instance (the MIT License does not ask for it). An http(s) URL.
   */
  readonly sourceUrl: string;
  /**
   * Demo-only mode (`DEMO_ONLY=true`; backend/AGENTS.md, Demo-only mode and legal pages): the instance serves the app and its demo
   * organisations only. No sign-in (an OAuth client id is refused), no service-account mode, and none of the
   * routes that call Google (scope search, preflight, live pull, export read) is registered; /api/config says
   * so with `demoOnly`, and the SPA's Connect page then offers only the demo.
   */
  readonly demoOnly: boolean;
  /** The Impressum and privacy notice the instance publishes (`LEGAL_DIR` or `LEGAL_BUNDLE`; legal.ts). */
  readonly legal: LegalTexts;
  /**
   * Links to an Impressum and a privacy notice the operator publishes elsewhere, such as their own website
   * (`LEGAL_IMPRESSUM_URL`, `LEGAL_PRIVACY_URL`; https only), reported in /api/config for the app's footer; null where
   * unset. A page is either served from a text (`legal`) or linked, never both ({@link parseConfig} refuses that).
   */
  readonly legalUrls: LegalUrls;
  /**
   * The render API (`POST /api/render`) and its limits, or null when it is off: `RENDER_API=false`, or a
   * demo-only instance, which never has it.
   */
  readonly render: RenderLimits | null;
};

/** The addresses of the legal pages an operator publishes elsewhere, or null per page. */
export type LegalUrls = { readonly impressum: string | null; readonly privacy: string | null };

/**
 * The limits of `POST /api/render` (backend/AGENTS.md, The render API); each is an environment
 * variable.
 */
export type RenderLimits = {
  /** Assets per render, for every source (`RENDER_MAX_ASSETS`). */
  readonly maxAssets: number;
  /** Pixels per PNG; a larger one is drawn at the largest scale that fits (`RENDER_MAX_PIXELS`). */
  readonly maxPixels: number;
  /** From the start of a render (the pull or the upload included) to the first byte of its answer (`RENDER_TIMEOUT_MS`). */
  readonly timeoutMs: number;
  /** The uploaded file of a render (`RENDER_MAX_BODY_BYTES`). */
  readonly maxBodyBytes: number;
};

/**
 * The default for SOURCE_URL: the project's repository, the same as the frontend's `DEFAULT_SOURCE_URL`
 * (frontend/src/source.ts); config.test.ts fails while the two, or the e2e expectation, disagree. A fork
 * changes all of them (docs/contributing.md, Releases). Whoever runs a modified version sets SOURCE_URL to
 * the source of that version.
 */
export const DEFAULT_SOURCE_URL = 'https://github.com/florianchrometz/gcportrait';

/** Raised for an invalid environment. The message names the variables, never their values. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Treats unset and blank variables alike, so `FOO=` in an .env file means "use the default". */
function blankToUndefined(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

function optional<T extends z.ZodType>(schema: T) {
  return z.preprocess(blankToUndefined, schema.optional());
}

/** The longest legal-page URL accepted: an address, not a document. */
const MAX_LEGAL_URL_LENGTH = 2048;

/**
 * A link to a legal page kept elsewhere: an absolute https URL (each becomes a link in the app's footer, so no other
 * scheme, and no user name or password in it), at most 2048 characters.
 */
const LegalUrlSchema = z
  .string()
  .trim()
  .max(MAX_LEGAL_URL_LENGTH, `must be at most ${String(MAX_LEGAL_URL_LENGTH)} characters`)
  .pipe(z.url({ protocol: /^https$/, error: 'must be an https:// URL' }))
  .refine(
    (value) => {
      // Not a URL at all is the check above's to report (zod runs this one too).
      if (!URL.canParse(value)) return true;
      const url = new URL(value);
      return url.username === '' && url.password === '';
    },
    { message: 'must not hold a user name or password' },
  );

const EnvSchema = z.object({
  PORT: optional(z.coerce.number().int().min(1).max(65535)),
  HOST: optional(z.string().trim()),
  LOG_LEVEL: optional(z.enum(LOG_LEVELS)),
  LOG_FORMAT: optional(z.enum(LOG_FORMATS)),
  OAUTH_CLIENT_ID: optional(
    z
      .string()
      .trim()
      .regex(/^[\w.-]+$/, 'must look like a Google OAuth client id (letters, digits, dots, dashes)'),
  ),
  // Only the exact string "true" enables SA mode; every other value leaves it off (fail closed). A value
  // that is neither "true" nor "false" is probably a typo, which configWarnings() reports at start-up.
  SA_MODE_ENABLED: optional(z.string()),
  // Exactly "true" or "false" (unset: off). Anything else stops start-up: a typo here would otherwise leave the
  // check off while the operator believes it on, and failing closed means not starting at all.
  SA_MODE_STRICT_EXPOSURE: optional(
    z.enum(['true', 'false'], { error: 'must be "true" or "false" (or unset, which means off)' }),
  ),
  BACKEND_SA_EMAIL: optional(z.email()),
  // Plain text on one line. Never Google: gcportrait is not affiliated with Google (AGENTS.md,
  // Non-affiliation, brand and legal).
  HOSTED_BY: optional(
    z
      .string()
      .trim()
      .max(80, 'must be at most 80 characters')
      .regex(/^[^\p{Cc}\p{Cf}<>]+$/u, 'must be plain text on one line, without < or >')
      .refine((value) => !/google/i.test(value), {
        message: 'must not name Google: gcportrait is not affiliated with Google',
      }),
  ),
  STATIC_DIR: optional(z.string()),
  TRUST_PROXY_HOPS: optional(z.coerce.number().int().min(0).max(10)),
  APP_VERSION: optional(z.string().trim().max(64)),
  // Only http(s): the value becomes a link in the app (a javascript: URL would be a script).
  SOURCE_URL: optional(
    z
      .string()
      .trim()
      .pipe(z.url({ protocol: /^https?$/, error: 'must be an http:// or https:// URL' })),
  ),
  // Exactly "true" or "false" (unset: off), like SA_MODE_STRICT_EXPOSURE: a typo must not leave a public instance
  // in a mode its operator did not mean.
  DEMO_ONLY: optional(
    z.enum(['true', 'false'], { error: 'must be "true" or "false" (or unset, which means off)' }),
  ),
  // The legal pages (legal.ts): a directory with impressum.md and/or privacy.md, or the same as one JSON bundle.
  LEGAL_DIR: optional(z.string().trim()),
  LEGAL_BUNDLE: optional(z.string().trim()),
  // Or links to legal pages the operator publishes elsewhere (their own website), one per page.
  LEGAL_IMPRESSUM_URL: optional(LegalUrlSchema),
  LEGAL_PRIVACY_URL: optional(LegalUrlSchema),
  // The render API: exactly "true" or "false" (unset: on, except on a demo-only instance), and its limits.
  RENDER_API: optional(
    z.enum(['true', 'false'], { error: 'must be "true" or "false" (or unset, which means on)' }),
  ),
  RENDER_MAX_ASSETS: optional(z.coerce.number().int().min(1).max(1_000_000)),
  RENDER_MAX_PIXELS: optional(z.coerce.number().int().min(1_000_000).max(RENDER_MAX_PIXELS)),
  RENDER_TIMEOUT_MS: optional(z.coerce.number().int().min(10_000).max(3_600_000)),
  RENDER_MAX_BODY_BYTES: optional(
    z.coerce
      .number()
      .int()
      .min(1024 * 1024)
      .max(1024 * 1024 * 1024),
  ),
});

const PackageManifestSchema = z.object({ version: z.string() });

/** The `version` field of backend/package.json. */
export function readPackageVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  return PackageManifestSchema.parse(manifest).version;
}

/** Where the SPA build lands by default: frontend/dist next to the backend package. */
export const DEFAULT_STATIC_DIR = path.resolve(PACKAGE_ROOT, '..', 'frontend', 'dist');

/** The documented values of SA_MODE_ENABLED. */
const SA_MODE_VALUES: ReadonlySet<string> = new Set(['true', 'false']);

/**
 * Warnings about an environment that parses but is probably not what the operator meant; main.ts logs them
 * at start-up. Like ConfigError, a warning names the variable and never echoes its value. (An unknown
 * SA_MODE_ENABLED leaves the mode off, which is closed already; an unknown SA_MODE_STRICT_EXPOSURE would leave a
 * safety check off, so it is an error instead.)
 */
export function configWarnings(env: Readonly<Record<string, string | undefined>>): string[] {
  const warnings: string[] = [];
  const saMode = blankToUndefined(env.SA_MODE_ENABLED);
  if (typeof saMode === 'string' && !SA_MODE_VALUES.has(saMode)) {
    warnings.push('SA_MODE_ENABLED is neither "true" nor "false"; service-account mode stays off.');
  }
  return warnings;
}

/**
 * Parses the environment into a typed, frozen config. Throws ConfigError listing every invalid variable.
 * @param env usually `process.env`; tests pass a plain object.
 * @param cwd base for a relative STATIC_DIR.
 */
export function parseConfig(
  env: Readonly<Record<string, string | undefined>>,
  cwd = process.cwd(),
): ServerConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`);
    throw new ConfigError(`Invalid backend configuration:\n${problems.join('\n')}`);
  }
  const vars = result.data;
  const demoOnly = vars.DEMO_ONLY === 'true';
  const problems: string[] = [];
  if (demoOnly && vars.OAUTH_CLIENT_ID !== undefined) {
    problems.push(
      'OAUTH_CLIENT_ID: must be unset with DEMO_ONLY=true (a demo-only instance offers no sign-in)',
    );
  }
  if (demoOnly && vars.SA_MODE_ENABLED === 'true') {
    problems.push(
      'SA_MODE_ENABLED: must not be "true" with DEMO_ONLY=true (a demo-only instance reads no scope)',
    );
  }
  if (demoOnly && vars.RENDER_API === 'true') {
    problems.push(
      'RENDER_API: must not be "true" with DEMO_ONLY=true (a demo-only instance has no render API)',
    );
  }
  let legal: LegalTexts = NO_LEGAL_TEXTS;
  if (vars.LEGAL_DIR !== undefined && vars.LEGAL_BUNDLE !== undefined) {
    problems.push('LEGAL_DIR, LEGAL_BUNDLE: set one of them, not both');
  } else {
    try {
      if (vars.LEGAL_DIR !== undefined) legal = readLegalDir(path.resolve(cwd, vars.LEGAL_DIR));
      if (vars.LEGAL_BUNDLE !== undefined) legal = parseLegalBundle(vars.LEGAL_BUNDLE);
    } catch (error) {
      // The message names the variable and the file (legal.ts), never the text.
      if (!(error instanceof LegalTextError)) throw error;
      problems.push(error.message);
    }
  }
  // A page is served from a text or linked, not both: the app would not know which one to show.
  const source = vars.LEGAL_DIR !== undefined ? 'LEGAL_DIR' : 'LEGAL_BUNDLE';
  if (vars.LEGAL_IMPRESSUM_URL !== undefined && legal.impressum !== null) {
    problems.push(
      `LEGAL_IMPRESSUM_URL: must be unset while ${source} holds an Impressum (serve the text or link the page, not both)`,
    );
  }
  if (vars.LEGAL_PRIVACY_URL !== undefined && legal.privacy !== null) {
    problems.push(
      `LEGAL_PRIVACY_URL: must be unset while ${source} holds a privacy notice (serve the text or link the page, not both)`,
    );
  }
  if (problems.length > 0) {
    throw new ConfigError(
      `Invalid backend configuration:\n${problems.map((problem) => `  ${problem}`).join('\n')}`,
    );
  }
  return Object.freeze({
    port: vars.PORT ?? 8080,
    host: vars.HOST ?? '0.0.0.0',
    logLevel: vars.LOG_LEVEL ?? 'info',
    logFormat: vars.LOG_FORMAT ?? 'json',
    oauthClientId: vars.OAUTH_CLIENT_ID ?? null,
    saModeEnabled: vars.SA_MODE_ENABLED === 'true',
    saStrictExposure: vars.SA_MODE_STRICT_EXPOSURE === 'true',
    backendServiceAccount: vars.BACKEND_SA_EMAIL ?? null,
    hostedBy: vars.HOSTED_BY ?? null,
    staticDir: vars.STATIC_DIR === undefined ? DEFAULT_STATIC_DIR : path.resolve(cwd, vars.STATIC_DIR),
    trustProxyHops: vars.TRUST_PROXY_HOPS ?? 0,
    version: vars.APP_VERSION ?? readPackageVersion(),
    sourceUrl: vars.SOURCE_URL ?? DEFAULT_SOURCE_URL,
    demoOnly,
    legal,
    legalUrls: Object.freeze({
      impressum: vars.LEGAL_IMPRESSUM_URL ?? null,
      privacy: vars.LEGAL_PRIVACY_URL ?? null,
    }),
    render: !demoOnly && (vars.RENDER_API ?? 'true') === 'true' ? renderLimitsOf(vars) : null,
  });
}

/** The render API's limits, the defaults where a variable is unset. */
function renderLimitsOf(vars: z.infer<typeof EnvSchema>): RenderLimits {
  return Object.freeze({
    maxAssets: vars.RENDER_MAX_ASSETS ?? 60000,
    maxPixels: vars.RENDER_MAX_PIXELS ?? 67108864,
    timeoutMs: vars.RENDER_TIMEOUT_MS ?? 300000,
    maxBodyBytes: vars.RENDER_MAX_BODY_BYTES ?? 26214400,
  });
}
