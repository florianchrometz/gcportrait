// SPDX-License-Identifier: MIT
/**
 * Service-account mode as one server runs it (agents.md, Security and privacy, The service-account gate): the
 * config the server publishes, reconciled with the identity Application Default Credentials resolved to
 * (./identity.ts), and the gate (./gate.ts) built from both.
 */
import { ConfigError, type ServerConfig } from '../config.js';
import { ServiceAccountGate } from './gate.js';
import type { ServiceAccountIdentity } from './identity.js';

/**
 * The config with the account the instance really reads as: with service-account mode on and an identity, the
 * published email (`backendServiceAccount` in /api/config, the `--member` of every command) is the identity's.
 * `BACKEND_SA_EMAIL` may name it too, but never another account: customers would grant the wrong one, so that
 * stops start-up.
 */
export function withServiceAccount(
  config: ServerConfig,
  identity: ServiceAccountIdentity | undefined,
): ServerConfig {
  if (!config.saModeEnabled || identity === undefined) return config;
  const configured = config.backendServiceAccount;
  if (configured !== null && configured.toLowerCase() !== identity.email.toLowerCase())
    throw new ConfigError(
      'Invalid backend configuration:\n  BACKEND_SA_EMAIL: names another account than the one Application Default ' +
        `Credentials resolve to (${identity.email}); set it to that account or leave it unset.`,
    );
  return Object.freeze({ ...config, backendServiceAccount: identity.email });
}

/** The gate for a config and an identity, or null when service-account mode is off or has no identity. */
export function serviceAccountGateFor(
  config: Pick<ServerConfig, 'saModeEnabled' | 'saStrictExposure'>,
  identity: ServiceAccountIdentity | undefined,
): ServiceAccountGate | null {
  if (!config.saModeEnabled || identity === undefined) return null;
  return new ServiceAccountGate({ identity, strictExposure: config.saStrictExposure });
}
