// SPDX-License-Identifier: MIT
import { randomUUID } from 'node:crypto';

import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import type { DestinationStream } from 'pino';

import type { ServiceAccountIdentity } from './auth/identity.js';
import { serviceAccountGateFor, withServiceAccount } from './auth/mode.js';
import type { ServerConfig } from './config.js';
import { errorBody, isErrorResponse, sendError } from './errors.js';
import { loggerOptions } from './logging.js';
import { registerAssetStreamRoute } from './routes/assets.js';
import { registerConfigRoute } from './routes/config.js';
import { registerExportReadRoute } from './routes/export.js';
import { registerLegalRoute } from './routes/legal.js';
import { registerPreflightRoute } from './routes/preflight.js';
import { createRenderLock, registerRenderRoute } from './routes/render.js';
import { registerScopeSearchRoute } from './routes/scopes.js';
import { workerRunner, type RenderRunner } from './render/runner.js';
import { HealthResponseSchema, toFastifySchema, type HealthResponse } from './schemas.js';
import { crossOriginPolicies, cspDirectives, PERMISSIONS_POLICY } from './security.js';
import {
  CACHE_HASHED_ASSET,
  CACHE_REVALIDATE,
  isApiPath,
  isHashedAsset,
  isSpaRoute,
  loadSpaBundle,
} from './spa.js';
import { PageBudget } from './stream/page-budget.js';
import { StreamSlots } from './stream/slots.js';
import { createUpstreamClient, type UpstreamOptions } from './upstream/request.js';

/**
 * The gcportrait backend (AGENTS.md, Security and privacy, The backend): stateless, no database, no stored
 * credentials. It serves the health checks (/healthz for the container's probes, /api/healthz from outside:
 * Cloud Run's front end answers /healthz itself), /api/config, /api/legal, the scope search and the
 * permission preflight, the live pull and the export read with the caller's token or, behind its gate, the
 * service account, the render API (SVG, PNG and draw.io drawn on the server, unless RENDER_API=false), and in
 * the production image the built SPA. In demo-only mode (DEMO_ONLY=true) the routes that call Google, the
 * render API among them, are not registered at all, so they answer the JSON 404 of any unknown route.
 * backend/README.md and docs/api.md describe every route.
 */

export type BuildServerOptions = {
  /** Where log lines go; defaults to stdout. Tests pass a capturing stream. */
  readonly logDestination?: DestinationStream;
  /** Request budget per client address and minute; tests lower it. */
  readonly rateLimitPerMinute?: number;
  /** How the streaming routes call Google: tests pass a mock `fetch`, timers and jitter. */
  readonly upstream?: UpstreamOptions;
  /**
   * Service-account mode's identity: the account Application Default Credentials resolved to (main.ts;
   * tests pass a fake). With `SA_MODE_ENABLED=true` it builds the gate (auth/gate.ts) that every `mode: "sa"`
   * request goes through, and its email is the one /api/config publishes; without it, service-account requests
   * answer 501.
   */
  readonly serviceAccount?: ServiceAccountIdentity;
  /** Stream requests per token hash and minute, per streaming route. */
  readonly streamRateLimitPerMinute?: number;
  /** Scope searches and preflights per token hash and minute; tests lower it. */
  readonly scopeRateLimitPerMinute?: number;
  /** The live pulls' page budget (stream/page-budget.ts); tests pass a small one and watch it. */
  readonly pageBudget?: PageBudget;
  /** The streams per token that run at once (stream/slots.ts), shared by the streaming routes; tests hold some. */
  readonly streamSlots?: StreamSlots;
  /** How long a client may take to send a whole request; tests lower it. */
  readonly requestTimeoutMs?: number;
  /** How long a stream waits for its client to take a piece (stream/ndjson.ts); tests lower it. */
  readonly streamStallMs?: number;
  /**
   * How `POST /api/render` runs a render (render/runner.ts): by default a fresh worker per render; tests pass
   * the same job in process (render/in-process.ts).
   */
  readonly renderRunner?: RenderRunner;
  /** One render per instance (`createRenderLock`, routes/render.ts); tests pass one to hold it. */
  readonly renderLock?: StreamSlots;
  /** Renders per token hash and minute (routes/render.ts); tests raise it. */
  readonly renderRateLimitPerMinute?: number;
};

/** Default budget per client address and minute: generous for a person, a brake on a scripted flood. */
export const DEFAULT_RATE_LIMIT_PER_MINUTE = 600;

/** Default stream requests per token hash and minute: a timeline scrub fetches a few ticks, never dozens. */
export const DEFAULT_STREAM_RATE_LIMIT_PER_MINUTE = 30;

/**
 * The largest request body accepted (docs/security.md §2). The largest legitimate
 * one is a live pull with 100 asset-type patterns of 256 characters, about 27 KiB; a scope search's page token is
 * at most 8 KiB.
 */
export const BODY_LIMIT_BYTES = 64 * 1024;

/**
 * How long a client may take to send its request (docs/security.md §4): its headers (Node's `requestTimeout`,
 * which Fastify leaves at no limit) and, separately, its body (the `preParsing` hook below). Node alone would
 * allow the body more: Fastify sets `requestTimeout` on the server after creating it, when Node has already
 * taken `headersTimeout` from its own default (60 s), and Node's check, given a headers limit above the
 * request limit, swaps the two, so the whole request would get 60 s (with the two limits scaled down to 1.5 s
 * and 3 s, Node answers unfinished headers with 408 after 1.5 s but an unfinished body only after 3 s). A
 * sender that dribbles a request cannot hold a connection open for longer; how long a response streams is not
 * limited by it.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Whether a request announces a body (a length above zero, or a chunked transfer). */
function announcesBody(request: FastifyRequest): boolean {
  const length = request.headers['content-length'];
  return request.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0');
}

/** A caller-supplied `x-request-id` is kept only when short and plain; otherwise a UUID is minted. */
const REQUEST_ID_PATTERN = /^[\w.:-]{1,128}$/;

function requestIdFor(header: string | string[] | undefined): string {
  return typeof header === 'string' && REQUEST_ID_PATTERN.test(header) ? header : randomUUID();
}

function pathnameOf(request: FastifyRequest): string {
  const queryStart = request.url.indexOf('?');
  return queryStart < 0 ? request.url : request.url.slice(0, queryStart);
}

function sendIndex(reply: FastifyReply, indexHtml: string): FastifyReply {
  return reply.code(200).type('text/html; charset=utf-8').header('cache-control', 'no-cache').send(indexHtml);
}

/**
 * Trust the forwarding headers of the nearest `hops` proxies. Fastify 5 accepts a bare hop count for
 * `trustProxy` but deliberately fails closed with it (it trusts no address), because a hop count alone cannot
 * tell a proxy from a client that connects directly and sends its own X-Forwarded-For. This function brings
 * hop-count trust back on purpose, so it is correct only where no client can reach the process directly,
 * which holds on Cloud Run (requests always arrive through Google's front end). Hence 0 (trust nothing)
 * unless the operator sets TRUST_PROXY_HOPS for such a deployment.
 */
function trustProxyFor(hops: number): false | ((address: string, hop: number) => boolean) {
  return hops > 0 ? (_address, hop) => hop < hops : false;
}

/** The HTTP status carried by a thrown value (Fastify errors, the rate limiter's body), else 500. */
function statusCodeOf(error: unknown): number {
  if (typeof error === 'object' && error !== null && 'statusCode' in error) {
    const { statusCode } = error;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode <= 599) return statusCode;
  }
  return 500;
}

/** Builds the Fastify app for a parsed config. Does not listen: main.ts does, tests use `inject`. */
export async function buildServer(
  configured: ServerConfig,
  options: BuildServerOptions = {},
): Promise<FastifyInstance> {
  // With service-account mode on, the published account is the identity's own (auth/mode.ts).
  const config = withServiceAccount(configured, options.serviceAccount);
  const spa = loadSpaBundle(config.staticDir);
  const requestTimeout = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;

  const app = Fastify({
    logger: loggerOptions(config, options.logDestination),
    requestIdHeader: false,
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    genReqId: (request) => requestIdFor(request.headers['x-request-id']),
    trustProxy: trustProxyFor(config.trustProxyHops),
    // Request bodies are small JSON documents (scope search, preflight, a pull's parameters); streams flow outwards.
    bodyLimit: BODY_LIMIT_BYTES,
    requestTimeout,
    // Node checks the request timeout on a timer (every 30 s by default); twice per timeout keeps it near its value.
    http: { connectionsCheckingInterval: Math.max(50, Math.floor(requestTimeout / 2)) },
  });

  // The body's own deadline (Node's check would give the whole request 60 s, see REQUEST_TIMEOUT_MS). A body still
  // arriving after it fails the read with 408 (Fastify answers it through the error handler) and closes the
  // connection.
  app.addHook('preParsing', (request, reply, payload, done) => {
    if (!announcesBody(request)) {
      done(null, payload);
      return;
    }
    const timer = setTimeout(() => {
      reply.header('connection', 'close');
      payload.emit(
        'error',
        Object.assign(new Error('The request body did not arrive in time.'), { statusCode: 408 }),
      );
    }, requestTimeout);
    const stop = (): void => {
      clearTimeout(timer);
    };
    payload.once('end', stop);
    payload.once('close', stop);
    payload.once('error', stop);
    done(null, payload);
  });

  app.addHook('onRequest', (request, reply, done) => {
    reply.header('x-request-id', request.id);
    // Not part of helmet: no device, sensor or media feature for the page or anything it embeds (security.ts).
    reply.header('permissions-policy', PERMISSIONS_POLICY);
    const pathname = pathnameOf(request);
    if (isApiPath(pathname) || pathname === '/healthz') reply.header('cache-control', 'no-store');
    done();
  });

  // Google's sign-in window must reach its opener; a demo-only instance has none and is cross-origin isolated
  // instead (security.ts, crossOriginPolicies).
  const crossOrigin = crossOriginPolicies(config.demoOnly);
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: cspDirectives(spa?.scriptHashes ?? [], { google: !config.demoOnly }),
    },
    // X-Frame-Options for browsers without CSP frame-ancestors; DENY matches frame-ancestors 'none'.
    frameguard: { action: 'deny' },
    crossOriginOpenerPolicy: { policy: crossOrigin.opener },
    crossOriginEmbedderPolicy: crossOrigin.embedder === null ? false : { policy: crossOrigin.embedder },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
  });

  await app.register(rateLimit, {
    global: true,
    max: options.rateLimitPerMinute ?? DEFAULT_RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    // The limiter throws this body (its own headers, Retry-After among them, already set); the error handler sends it.
    errorResponseBuilder: (request, context) =>
      errorBody(request, {
        status: context.statusCode,
        message: `Rate limit exceeded; retry in ${context.after}.`,
      }),
  });

  app.setErrorHandler(async (error: unknown, request, reply) => {
    const status = statusCodeOf(error);
    if (status >= 500) {
      request.log.error({ err: error }, 'request failed');
      return sendError(request, reply, { status, code: 'INTERNAL', message: 'Internal error.' });
    }
    if (isErrorResponse(error)) return reply.code(status).send(error);
    const message = error instanceof Error ? error.message : 'Request rejected.';
    return sendError(request, reply, { status, message });
  });

  const health = (): Promise<HealthResponse> =>
    Promise.resolve({ status: 'ok' as const, version: config.version });
  const healthSchema = { response: { 200: toFastifySchema(HealthResponseSchema) } };
  // The container's own check: Cloud Run's startup and liveness probes, Docker's HEALTHCHECK, local runs. Never
  // rate limited, so a busy client address cannot make an instance look dead.
  app.get<{ Reply: HealthResponse }>(
    '/healthz',
    { config: { rateLimit: false }, logLevel: 'warn', schema: healthSchema },
    health,
  );
  // The same answer where Cloud Run's front end lets it through: it keeps paths ending in "z" for itself and
  // answers /healthz with its own 404, so checks from outside (deploy.sh's readiness wait, docs) use this one.
  // Rate limited like every other /api route.
  app.get<{ Reply: HealthResponse }>('/api/healthz', { logLevel: 'warn', schema: healthSchema }, health);

  registerConfigRoute(app, config);
  registerLegalRoute(app, config);

  // The routes that call Google, with the caller's token or the service account. A demo-only instance has none
  // of them: no upstream client, no gate, no route.
  if (!config.demoOnly) await registerGoogleRoutes(app, config, options);

  if (spa !== null) {
    // index.html always comes from memory (sendIndex) so that the CSP hashes match what is sent.
    app.get('/', async (_request, reply) => sendIndex(reply, spa.indexHtml));
    await app.register(fastifyStatic, {
      root: spa.root,
      prefix: '/',
      index: false,
      wildcard: true,
      // A file or folder whose name starts with a dot is never served (@fastify/static's default serves them).
      dotfiles: 'ignore',
      // Static files never answer for the API, even if the build output happened to contain an api/ folder.
      allowedPath: (pathname) => !isApiPath(pathname),
      setHeaders: (reply, filePath) => {
        reply.header(
          'cache-control',
          isHashedAsset(spa.root, filePath) ? CACHE_HASHED_ASSET : CACHE_REVALIDATE,
        );
      },
    });
  }

  app.setNotFoundHandler({ preHandler: app.rateLimit() }, async (request, reply) => {
    const pathname = pathnameOf(request);
    const isPageRequest = request.method === 'GET' || request.method === 'HEAD';
    if (spa !== null && isPageRequest && isSpaRoute(pathname)) return sendIndex(reply, spa.indexHtml);
    const hint =
      spa === null && !isApiPath(pathname)
        ? ' No SPA build is present; in development the Vite dev server serves the app.'
        : config.demoOnly && isApiPath(pathname)
          ? ' This instance runs in demo-only mode: it offers no sign-in and reads nothing from Google Cloud.'
          : '';
    return sendError(request, reply, {
      status: 404,
      code: 'ROUTE_NOT_FOUND',
      message: `No route for ${request.method} ${pathname}.${hint}`,
    });
  });

  return app;
}

/**
 * The live pull and the export read, the scope search and the permission preflight, and the render API: the
 * caller's token forwarded to the allowlisted Google hosts, or behind its gate the service account.
 */
async function registerGoogleRoutes(
  app: FastifyInstance,
  config: ServerConfig,
  options: BuildServerOptions,
): Promise<void> {
  const upstream = createUpstreamClient(options.upstream);
  // Service-account mode's gate: every route that takes `mode: "sa"` goes through it.
  const gate = serviceAccountGateFor(config, options.serviceAccount);
  const slots = options.streamSlots ?? new StreamSlots();
  const budget = options.pageBudget ?? new PageBudget();
  const streamRate = options.streamRateLimitPerMinute ?? DEFAULT_STREAM_RATE_LIMIT_PER_MINUTE;
  const stall = options.streamStallMs === undefined ? {} : { stallMs: options.streamStallMs };
  registerAssetStreamRoute(app, {
    config,
    upstream,
    slots,
    budget,
    serviceAccount: gate,
    ratePerMinute: streamRate,
    ...stall,
  });
  registerExportReadRoute(app, { upstream, slots, ratePerMinute: streamRate, ...stall });
  // The scope picker's search and the permission preflight, through the same client.
  const scopeRate = options.scopeRateLimitPerMinute;
  registerScopeSearchRoute(app, { upstream, ...(scopeRate === undefined ? {} : { perMinute: scopeRate }) });
  registerPreflightRoute(app, {
    config,
    upstream,
    gate,
    ...(scopeRate === undefined ? {} : { perMinute: scopeRate }),
  });
  // The render API: a pull through the same client, gate, slots and page budget as the stream.
  if (config.render !== null) {
    const renderRate = options.renderRateLimitPerMinute;
    await registerRenderRoute(app, {
      limits: config.render,
      authority: { saModeEnabled: config.saModeEnabled, serviceAccount: gate, upstream },
      slots,
      budget,
      runner: options.renderRunner ?? workerRunner(),
      lock: options.renderLock ?? createRenderLock(),
      fieldBytes: BODY_LIMIT_BYTES,
      bodyTimeoutMs: options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
      version: config.version,
      ...(renderRate === undefined ? {} : { ratePerMinute: renderRate }),
      ...stall,
    });
  }
}
