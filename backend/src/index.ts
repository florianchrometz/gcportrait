// SPDX-License-Identifier: MIT

/** Public surface of the backend package, for tests and future tooling. The process entry point is main.ts. */
export { ConfigError, parseConfig, type ServerConfig } from './config.js';
export { buildServer, DEFAULT_RATE_LIMIT_PER_MINUTE, type BuildServerOptions } from './server.js';
export type { ErrorResponse, HealthResponse, PublicConfigResponse } from './schemas.js';
