// SPDX-License-Identifier: MIT
/**
 * What a live pull takes and how it is authorised, shared by the routes that pull a scope: `POST
 * /api/assets/stream` (the app's pull, streamed as frames) and `POST /api/render` with a `scope` source,
 * so both read Cloud Asset Inventory with the same fields, the same mode rule and the same credentials.
 *
 * - The fields: `{ scope, readTime?, assetTypes?, mode, quotaProject? }`. In `user` mode `quotaProject` is
 *   required: it goes into `x-goog-user-project`, so the user's own project pays (never the instance's;
 *   AGENTS.md, Security and privacy, Quota project and the permission check). In `sa` mode it is refused: the
 *   instance's own project pays.
 * - Service-account mode only when the operator enabled it (403 otherwise), and only with the instance's identity
 *   (501 otherwise): the gate is never skipped.
 * - The credentials of each page: the caller's token and quota project in user mode; in service-account mode
 *   the service-account gate (../auth/gate.ts) before every CAI call. Its first run decides whether the pull
 *   starts at all (a refusal is answered as an HTTP error by `sendRefusal`); a later refusal ends the pull
 *   with an `error` frame.
 */
import { TimestampSchema } from '@gcportrait/model';
import type { FastifyReply, FastifyRequest } from 'fastify';
import * as z from 'zod';

import type { GateDecision, GatedRoute, ServiceAccountGate } from '../auth/gate.js';
import { refusalFrame, sendRefusal } from '../auth/refusal.js';
import type { UpstreamClient } from '../upstream/request.js';
import { sendError } from '../upstream/route-support.js';
import { QuotaProjectSchema, ScopeNameSchema, scopePath } from '../upstream/scope.js';
import type { AssetListQuery, PageCredentials } from './asset-list.js';

/** An `assetTypes` entry: an RE2 pattern over asset type names (`compute.googleapis.com/.*`); Google checks it. */
const ASSET_TYPE_PATTERN = /^[\w.*+?^$|()[\]{}\\/,-]{1,256}$/;

/** The pull's fields, without the mode rule ({@link checkPullMode}), so a route can add its own. */
export const PullFieldsSchema = z.strictObject({
  scope: ScopeNameSchema,
  readTime: TimestampSchema.optional(),
  assetTypes: z
    .array(
      z.string().regex(ASSET_TYPE_PATTERN, 'must be an asset type pattern such as compute.googleapis.com/.*'),
    )
    .min(1)
    .max(100)
    .optional(),
  mode: z.enum(['user', 'sa']),
  quotaProject: QuotaProjectSchema.optional(),
});
export type PullFields = z.infer<typeof PullFieldsSchema>;

/** The mode rule: a quota project is required in user mode and refused in service-account mode. */
export function checkPullMode(
  body: Pick<PullFields, 'mode' | 'quotaProject'>,
  context: z.RefinementCtx,
  path: readonly PropertyKey[] = [],
): void {
  if (body.mode === 'user' && body.quotaProject === undefined)
    context.addIssue({
      code: 'custom',
      path: [...path, 'quotaProject'],
      message: 'is required in user mode: the project whose Cloud Asset API quota the pull uses',
    });
  if (body.mode === 'sa' && body.quotaProject !== undefined)
    context.addIssue({
      code: 'custom',
      path: [...path, 'quotaProject'],
      message: "must be left out in service-account mode, which uses this instance's own project",
    });
}

/** The query of the pull's `assetListFrames`. */
export function assetListQueryOf(fields: PullFields): AssetListQuery {
  return {
    scopePath: scopePath(fields.scope),
    ...(fields.readTime === undefined ? {} : { readTime: fields.readTime }),
    ...(fields.assetTypes === undefined ? {} : { assetTypes: fields.assetTypes }),
  };
}

export interface PullAuthority {
  /** Whether the operator enabled service-account mode. */
  readonly saModeEnabled: boolean;
  /** Service-account mode's gate, or null when this instance has no identity for it. */
  readonly serviceAccount: ServiceAccountGate | null;
  readonly upstream: UpstreamClient;
}

/**
 * Answers a service-account pull this instance cannot run (403 with the mode off, 501 without an identity) and
 * returns the reply; null when the pull may go on.
 */
export function refuseUnavailableMode(
  request: FastifyRequest,
  reply: FastifyReply,
  mode: PullFields['mode'],
  authority: PullAuthority,
): FastifyReply | null {
  if (mode !== 'sa') return null;
  if (!authority.saModeEnabled)
    return sendError(request, reply, 403, 'Service-account mode is off on this gcportrait instance.');
  if (authority.serviceAccount === null)
    return sendError(
      request,
      reply,
      501,
      'Service-account mode is not available in this build of gcportrait.',
    );
  return null;
}

/** The credentials for each page of a pull, or the reply already sent (refused by the gate, or the client left). */
export type PullCredentials =
  | { readonly ok: true; readonly credentials: (signal: AbortSignal) => Promise<PageCredentials> }
  | { readonly ok: false; readonly reply: FastifyReply };

/**
 * The credentials of a pull (see the module comment), after {@link refuseUnavailableMode}. In service-account mode
 * the gate's first run happens here, before anything is streamed: a refusal is sent with `sendRefusal`, and a
 * client that left meanwhile gets 499. `route` names the route in the gate's audit line.
 */
export async function pullCredentials(
  request: FastifyRequest,
  reply: FastifyReply,
  fields: PullFields,
  callerToken: string,
  authority: PullAuthority,
  route: GatedRoute,
  signal: AbortSignal,
): Promise<PullCredentials> {
  const { serviceAccount } = authority;
  if (fields.mode !== 'sa' || serviceAccount === null) {
    const user: PageCredentials = {
      ok: true,
      token: callerToken,
      ...(fields.quotaProject === undefined ? {} : { quotaProject: fields.quotaProject }),
    };
    return { ok: true, credentials: () => Promise.resolve(user) };
  }
  // The gate runs before every CAI call; the first run decides whether the stream starts at all.
  const check = (pageSignal: AbortSignal): Promise<GateDecision> =>
    serviceAccount.check({
      scope: fields.scope,
      callerToken,
      route,
      context: { client: authority.upstream, signal: pageSignal, requestId: request.id, log: request.log },
    });
  const gate = async (pageSignal: AbortSignal): Promise<PageCredentials> => {
    const decision = await check(pageSignal);
    return decision.allowed
      ? { ok: true, token: decision.token }
      : { ok: false, frame: refusalFrame(decision) };
  };
  let first: GateDecision;
  try {
    first = await check(signal);
  } catch (error) {
    if (signal.aborted) return { ok: false, reply: reply.code(499).send() };
    throw error;
  }
  if (!first.allowed) return { ok: false, reply: sendRefusal(request, reply, first) };
  let pending: PageCredentials | null = { ok: true, token: first.token };
  return {
    ok: true,
    credentials: (pageSignal) => {
      const ready = pending;
      pending = null;
      return ready === null ? gate(pageSignal) : Promise.resolve(ready);
    },
  };
}
