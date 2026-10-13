// SPDX-License-Identifier: MIT
/**
 * The relation-kind table (skill gcp-asset-catalog §4) as data, in a module that imports no zod (types only),
 * so the renderer and the legend on the app's UI thread read it without the schema library.
 * relation.ts declares its row schema (`RelationKindInfoSchema`) and re-exports the table; relation.test.ts
 * checks every row against that schema. Nothing else keeps a second copy of this table.
 */
import type { RelationKind, RelationKindInfo } from './relation.js';

/** The relation-kind table as data. */
export const RELATION_KINDS: Readonly<Record<RelationKind, Readonly<RelationKindInfo>>> = {
  contains: {
    meaning:
      'hierarchy/containment (org→folder→project→VPC→subnet; cluster→namespace→workload; dataset→table)',
    direction: 'parent → child',
    defaultStyle: 'nesting',
    drawnByDefault: true,
  },
  attaches: {
    meaning: 'a resource sits on a network/subnet (instance NIC, Cloud SQL private IP, connector, PSA range)',
    direction: 'resource → network/subnet',
    defaultStyle: 'nesting-or-thin-arrow',
    drawnByDefault: true,
  },
  routes: {
    meaning:
      'traffic path (forwarding rule → proxy → URL map → backend service → NEG/IG → instances/services)',
    direction: 'upstream → downstream',
    defaultStyle: 'solid-arrow',
    drawnByDefault: true,
  },
  uses: {
    meaning: 'generic reference (instance → disk/image; function → topic; sink → bucket)',
    direction: 'user → used',
    defaultStyle: 'solid-arrow',
    drawnByDefault: true,
  },
  peers: {
    meaning: 'symmetric peering (VPC peering, VMware network peering)',
    direction: 'both',
    defaultStyle: 'dashed-double-headed',
    drawnByDefault: true,
  },
  connects: {
    meaning:
      'hybrid connectivity (VPN tunnel ↔ gateways, interconnect attachment ↔ router, NCC spokes ↔ hub)',
    direction: 'endpoint → endpoint',
    defaultStyle: 'solid-round-caps',
    drawnByDefault: true,
  },
  memberOf: {
    meaning: 'group membership (instance ∈ instance group via created-by; cluster ∈ fleet)',
    direction: 'member → group',
    defaultStyle: 'thin-dotted',
    drawnByDefault: true,
  },
  runsAs: {
    meaning: 'identity used by a workload (service account)',
    direction: 'workload → identity',
    defaultStyle: 'thin-dotted',
    drawnByDefault: false,
    lensOnly: ['identity'],
  },
  encryptedBy: {
    meaning: 'CMEK (any kmsKeyName)',
    direction: 'resource → key',
    defaultStyle: 'thin-dotted',
    drawnByDefault: false,
    lensOnly: ['security'],
  },
  secures: {
    meaning: 'perimeter/policy applies to (service perimeter → projects; firewall policy → network/folder)',
    direction: 'policy → target',
    defaultStyle: 'dashed-overlay-zone',
    drawnByDefault: false,
    lensOnly: ['security'],
  },
  triggers: {
    meaning: 'eventing (Eventarc/Pub/Sub push → service/function/workflow)',
    direction: 'source → target',
    defaultStyle: 'solid-arrow',
    drawnByDefault: true,
  },
  replicates: {
    meaning: 'replicas / cross-region copies (SQL replica, AlloyDB secondary)',
    direction: 'primary → replica',
    defaultStyle: 'solid-hollow-head',
    drawnByDefault: true,
  },
  shares: {
    meaning:
      "Shared VPC: a service project uses a host project's network (derived from cross-project attaches)",
    direction: 'service project → host project',
    defaultStyle: 'dashed-arrow',
    drawnByDefault: true,
  },
};
