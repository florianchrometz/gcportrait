// SPDX-License-Identifier: MIT
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { IncomingHttpHeaders } from 'node:http';
import { pino, type DestinationStream, type LoggerOptions } from 'pino';

import type { ServerConfig } from './config.js';

/**
 * Structured JSON logging (pino) shaped for Cloud Logging, with credentials and user identity kept out of
 * every line (agents.md, Security and privacy, principles 1 and 2). Request and response bodies are never
 * logged.
 */

export const REDACTED = '[redacted]';

/**
 * The request headers whose values may appear in a log line. Every other header is logged by name only,
 * with its value replaced by REDACTED.
 *
 * This is an allowlist on purpose. Credentials and identity reach a Cloud Run service in headers whose
 * names give no hint of it: the IAP-signed JWT (`x-goog-iap-jwt-assertion`), the authenticated user's
 * email and id (`x-goog-authenticated-user-email`, `x-goog-authenticated-user-id`), Cloud Run's ID token
 * (`x-serverless-authorization`), API keys (`x-api-key`), and whatever a proxy adds next. A denylist is
 * always one header behind; an allowlist fails closed. Add a header here only if its value can never carry
 * a credential, a session or a person's identity.
 */
export const LOGGED_HEADERS: ReadonlySet<string> = new Set([
  'accept',
  'accept-encoding',
  'accept-language',
  'content-length',
  'content-type',
  'host',
  'origin',
  'traceparent',
  'user-agent',
  'x-cloud-trace-context',
  'x-forwarded-proto',
]);

/** Whether a header's value may be logged (case-insensitive, as HTTP header names are). */
export function isLoggedHeader(name: string): boolean {
  return LOGGED_HEADERS.has(name.toLowerCase());
}

/** A copy of the headers in which only LOGGED_HEADERS keep their values; every other value is REDACTED. */
export function sanitizeHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    result[name] = isLoggedHeader(name) ? value : REDACTED;
  }
  return result;
}

/**
 * The URL as logged: the path, and `?[redacted]` in place of any query string. The API takes its input as
 * JSON bodies and the SPA keeps its view in the URL hash, which never reaches the server, so a query string
 * carries nothing worth logging; it could carry an OAuth code or a token sent there by mistake (agents.md,
 * Security and privacy, principle 2).
 */
export function sanitizeUrl(url: string): string {
  const queryStart = url.indexOf('?');
  return queryStart < 0 ? url : `${url.slice(0, queryStart)}?${REDACTED}`;
}

/**
 * Credential and identity headers redacted by pino itself in any object logged by hand with a `headers`
 * field: a second line of defence behind the request serializer, which already applies LOGGED_HEADERS.
 * Never log raw request headers; pass them through sanitizeHeaders.
 */
const CREDENTIAL_HEADERS = [
  'authorization',
  // The caller's Google token as the app sends it (stream/caller.ts).
  'x-gcportrait-token',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-goog-iap-jwt-assertion',
  'x-goog-authenticated-user-email',
  'x-goog-authenticated-user-id',
  'x-serverless-authorization',
] as const;

/** pino redaction paths for CREDENTIAL_HEADERS under `headers` and `req.headers`. */
export const REDACT_PATHS: readonly string[] = ['headers', 'req.headers'].flatMap((parent) =>
  CREDENTIAL_HEADERS.map((name) => `${parent}["${name}"]`),
);

/** Cloud Logging severities for pino levels, so log lines are classified without a log-router rule. */
const SEVERITY_BY_LEVEL: Readonly<Record<string, string>> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

/**
 * The request as logged. The client address is left out on purpose: it identifies a person as much as an
 * email does, so logs never carry it (agents.md, Security and privacy, The backend). Rate limiting still keys
 * on it in memory; it just never reaches a log line. `x-forwarded-for` is not on LOGGED_HEADERS for the same
 * reason.
 */
function serializeRequest(request: FastifyRequest) {
  return {
    method: request.method,
    url: sanitizeUrl(request.url),
    host: request.host,
    headers: sanitizeHeaders(request.headers),
  };
}

function serializeReply(reply: FastifyReply) {
  return { statusCode: reply.statusCode };
}

/**
 * pino options for the Fastify logger. `destination` lets tests capture the log lines; production writes
 * JSON to stdout, and LOG_FORMAT=pretty routes through pino-pretty for a terminal.
 */
export function loggerOptions(
  config: Pick<ServerConfig, 'logLevel' | 'logFormat' | 'version'>,
  destination?: DestinationStream,
): LoggerOptions & { stream?: DestinationStream } {
  const options: LoggerOptions & { stream?: DestinationStream } = {
    level: config.logLevel,
    messageKey: 'message',
    base: { service: 'gcportrait-backend', version: config.version },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label, number) => ({ severity: SEVERITY_BY_LEVEL[label] ?? 'DEFAULT', level: number }),
    },
    serializers: { req: serializeRequest, res: serializeReply, err: pino.stdSerializers.err },
    redact: { paths: [...REDACT_PATHS], censor: REDACTED },
  };
  if (destination !== undefined) {
    options.stream = destination;
  } else if (config.logFormat === 'pretty') {
    options.transport = {
      target: 'pino-pretty',
      options: { messageKey: 'message', translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname,service' },
    };
  }
  return options;
}
