// SPDX-License-Identifier: Apache-2.0
import {
  IdentityError,
  resolveServiceAccountIdentity,
  type ServiceAccountIdentity,
} from './auth/identity.js';
import { ConfigError, configWarnings, parseConfig } from './config.js';
import { buildServer } from './server.js';

/**
 * Process entry point: parse the environment once, resolve the service account's Application Default Credentials
 * when service-account mode is on (auth/identity.ts: a broken setup stops start-up here, not on the first request),
 * build the app, listen on PORT, and shut down cleanly on SIGTERM (Cloud Run sends it before stopping an instance)
 * or SIGINT (Ctrl+C in development).
 */

/** Cloud Run allows 10 s between SIGTERM and SIGKILL; leave a margin for the process to exit. */
const SHUTDOWN_GRACE_MS = 8000;

async function main(): Promise<void> {
  let config;
  try {
    config = parseConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  let serviceAccount: ServiceAccountIdentity | undefined;
  if (config.saModeEnabled) {
    try {
      serviceAccount = await resolveServiceAccountIdentity({ env: process.env });
    } catch (error) {
      if (error instanceof IdentityError) {
        process.stderr.write(
          `Service-account mode is on (SA_MODE_ENABLED=true), but its identity is not usable: ${error.message}\n`,
        );
        process.exitCode = 1;
        return;
      }
      throw error;
    }
  }

  let app;
  try {
    app = await buildServer(config, serviceAccount === undefined ? {} : { serviceAccount });
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }
  for (const warning of configWarnings(process.env)) app.log.warn(warning);
  if (serviceAccount !== undefined)
    app.log.info(
      {
        serviceAccount: {
          email: serviceAccount.email,
          source: serviceAccount.source,
          strictExposure: config.saStrictExposure,
          auditKey: config.saAuditKey !== null ? 'hmac-sha256' : 'sha256',
          callers: config.saCallers.length,
        },
      },
      'service-account mode on',
    );

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      app.log.error('graceful shutdown timed out; exiting');
      process.exit(1);
    }, SHUTDOWN_GRACE_MS);
    timer.unref();
    app.close().then(
      () => {
        process.exitCode = 0;
      },
      (error: unknown) => {
        app.log.error({ err: error }, 'error during shutdown');
        process.exitCode = 1;
      },
    );
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `gcportrait backend failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
