// SPDX-License-Identifier: Apache-2.0
/**
 * Property tests (fast-check): random organisations (folder trees, projects, some of them Shared VPC hosts,
 * resources that nest by name, by parent and by declaration, across projects too) built with random catalog
 * rules (random roles and network zone kinds, `contains` JSONPaths and `byParent`, weak and strong
 * `attaches`, `uses` and `peers` relations, unmapped types). The builder's memo changes no result: a build
 * with a memo that saw other days of the organisation equals a build without one.
 */
import { evaluateRelations } from '@gcportrait/catalog';
import {
  GraphBuildSchema,
  buildProjectIndex,
  type Asset,
  type Catalog,
  type CatalogZoneKind,
  type GraphBuild,
  type NodeRole,
} from '@gcportrait/model';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildGraphWithReport } from './build.js';
import { BuildMemo } from './memo.js';
import { HIERARCHY_TYPES, PROJECT_TYPE, projectNodeId } from './structure.js';
import {
  ORG,
  catalogWith,
  folder,
  organization,
  project,
  projectName,
  resource,
  type CatalogEntryInput,
} from './testing/fixtures.js';
import { isInside } from './testing/graph.js';
import { SCENARIO_ENTRIES } from './testing/scenario.js';

/** The scenario's Compute entry: instances attach to subnets (strong) and networks (weak). */
const SCENARIO_COMPUTE = SCENARIO_ENTRIES.filter((entry) => entry.service === 'compute.googleapis.com');

const SERVICE = 'boxes.googleapis.com';
const TYPE_COUNT = 5;
const typeName = (index: number): string => `${SERVICE}/Box${String(index)}`;

interface TypeSpec {
  readonly mapped: boolean;
  readonly role: NodeRole;
  readonly containsKids: boolean;
  readonly byParent: number | null;
  readonly attachesRefs: boolean;
  readonly attachesRefsWeak: boolean;
  readonly attachesWeakRef: boolean;
  readonly usesRefs: boolean;
  readonly peers: boolean;
  /** Containers only: drawn as a subnet or a VPC network (the Shared VPC derivation's network layers). */
  readonly zoneKind: 'subnet' | 'vpc' | 'product';
}

const typeSpec: fc.Arbitrary<TypeSpec> = fc.record({
  mapped: fc.boolean(),
  role: fc.constantFrom<NodeRole>('container', 'container', 'core', 'leaf', 'hidden'),
  containsKids: fc.boolean(),
  byParent: fc.option(fc.integer({ min: 0, max: TYPE_COUNT - 1 })),
  attachesRefs: fc.boolean(),
  attachesRefsWeak: fc.boolean(),
  attachesWeakRef: fc.boolean(),
  usesRefs: fc.boolean(),
  peers: fc.boolean(),
  zoneKind: fc.constantFrom<'subnet' | 'vpc' | 'product'>('subnet', 'vpc', 'product'),
});

type TypeInput = CatalogEntryInput['types'][string];
type RuleInput = NonNullable<TypeInput['relations']>[number];

function catalogFor(specs: readonly TypeSpec[]): Catalog {
  const types: Record<string, TypeInput> = {};
  specs.forEach((spec, index) => {
    if (!spec.mapped) return;
    const relations: RuleInput[] = [];
    if (spec.attachesRefs) {
      relations.push({
        kind: 'attaches',
        to: '$.data.refs[*]',
        normalize: 'name',
        ...(spec.attachesRefsWeak ? { weak: true } : {}),
      });
    }
    if (spec.attachesWeakRef) {
      relations.push({ kind: 'attaches', to: '$.data.weakRef', normalize: 'name', weak: true });
    }
    if (spec.usesRefs) relations.push({ kind: 'uses', to: '$.data.refs[*]', normalize: 'name' });
    if (spec.peers) relations.push({ kind: 'peers', to: '$.data.peer', normalize: 'name' });
    const contains: NonNullable<TypeInput['contains']> = [];
    if (spec.role === 'container' && spec.containsKids) contains.push('$.data.kids[*]');
    if (spec.role === 'container' && spec.byParent !== null)
      contains.push({ byParent: typeName(spec.byParent) });
    types[typeName(index)] = {
      role: spec.role,
      label: '{{data.title}}',
      relations,
      contains,
      ...(spec.role === 'container' ? { zoneKind: spec.zoneKind } : {}),
    };
  });
  return catalogWith([{ product: 'Boxes', service: SERVICE, icon: 'boxes', types }]);
}

interface ResourceSpec {
  readonly type: number;
  readonly project: number;
  /** Index of an earlier resource whose name this one continues, if any. */
  readonly under: number | null;
  /** 0: the project, 1: an earlier resource, 2: none. */
  readonly parentKind: 0 | 1 | 2;
  readonly parentPick: number;
  readonly refs: readonly number[];
  readonly kids: readonly number[];
  readonly weakRef: number | null;
  readonly peer: number | null;
  readonly title: string;
}

interface OrgSpec {
  /** Parent of each folder: -1 for the organisation, else an earlier folder. */
  readonly folders: readonly number[];
  /** Folder of each project: -1 for the organisation. */
  readonly projects: readonly number[];
  /** Whether each project's Compute settings mark it a Shared VPC host. */
  readonly hosts: readonly boolean[];
  readonly resources: readonly ResourceSpec[];
  readonly types: readonly TypeSpec[];
}

const orgSpec: fc.Arbitrary<OrgSpec> = fc
  .record({
    folderCount: fc.integer({ min: 0, max: 4 }),
    projectCount: fc.integer({ min: 1, max: 4 }),
    resourceCount: fc.integer({ min: 0, max: 24 }),
  })
  .chain(({ folderCount, projectCount, resourceCount }) =>
    fc.record({
      folders: fc.tuple(
        ...Array.from({ length: folderCount }, (_, i) => fc.integer({ min: -1, max: i - 1 })),
      ),
      projects: fc.array(fc.integer({ min: -1, max: folderCount - 1 }), {
        minLength: projectCount,
        maxLength: projectCount,
      }),
      hosts: fc.array(fc.boolean(), { minLength: projectCount, maxLength: projectCount }),
      resources: fc.tuple(
        ...Array.from({ length: resourceCount }, (_, i) =>
          fc.record({
            type: fc.integer({ min: 0, max: TYPE_COUNT - 1 }),
            project: fc.integer({ min: 0, max: projectCount - 1 }),
            under: i === 0 ? fc.constant(null) : fc.option(fc.integer({ min: 0, max: i - 1 })),
            parentKind: fc.constantFrom<0 | 1 | 2>(0, 1, 2),
            parentPick: fc.nat(),
            // References may point anywhere: other resources, projects, the organisation, or nothing.
            refs: fc.array(fc.integer({ min: -3, max: resourceCount }), { maxLength: 3 }),
            kids: fc.array(fc.integer({ min: -2, max: resourceCount - 1 }), { maxLength: 3 }),
            weakRef: fc.option(fc.integer({ min: -3, max: resourceCount })),
            peer: fc.option(fc.integer({ min: 0, max: resourceCount })),
            title: fc.string({ maxLength: 4 }),
          }),
        ),
      ),
      types: fc.array(typeSpec, { minLength: TYPE_COUNT, maxLength: TYPE_COUNT }),
    }),
  );

const projectNumber = (index: number): string => String(10000000001 + index);
const projectId = (index: number): string => `demo-p-${String(index + 1)}`;
const folderNumber = (index: number): string => String(20000000001 + index);

/** The assets an OrgSpec describes. Folder and project ancestors are consistent; nesting rules are random. */
function assetsFor(spec: OrgSpec): Asset[] {
  const folderChain = (index: number): string[] => {
    const chain: string[] = [];
    for (let current = index; current >= 0; current = spec.folders[current] ?? -1)
      chain.push(folderNumber(current));
    return chain;
  };
  const assets: Asset[] = [organization()];
  spec.folders.forEach((_, index) => {
    const [, ...above] = folderChain(index);
    assets.push(
      folder(
        folderNumber(index),
        `Folder ${String(index)}`,
        above.map((f) => `folders/${f}`),
      ),
    );
  });
  spec.projects.forEach((folderIndex, index) => {
    assets.push(
      project(projectNumber(index), projectId(index), folderIndex < 0 ? [] : folderChain(folderIndex)),
    );
    if (spec.hosts[index] === true) {
      assets.push(
        resource(
          `//compute.googleapis.com/projects/${projectId(index)}`,
          'compute.googleapis.com/Project',
          projectNumber(index),
          { name: projectId(index), xpnProjectStatus: 'HOST' },
          { folders: folderIndex < 0 ? [] : folderChain(folderIndex) },
        ),
      );
    }
  });
  const names: string[] = [];
  spec.resources.forEach((r, index) => {
    const base = r.under === null ? `//${SERVICE}/projects/${projectId(r.project)}` : (names[r.under] ?? '');
    names.push(`${base}/boxes/r${String(index)}`);
  });
  const nameOf = (pick: number): string => {
    if (pick === -1) return projectName(projectNumber(0));
    if (pick === -2) return ORG;
    if (pick === -3) return `//${SERVICE}/projects/missing/boxes/nowhere`;
    return names[pick] ?? 'not a resource name';
  };
  spec.resources.forEach((r, index) => {
    const earlier = index === 0 ? undefined : names[r.parentPick % index];
    const parent =
      r.parentKind === 0 ? projectName(projectNumber(r.project)) : r.parentKind === 1 ? earlier : undefined;
    const folderIndex = spec.projects[r.project] ?? -1;
    const asset = resource(
      names[index] ?? '',
      typeName(r.type),
      projectNumber(r.project),
      {
        title: r.title,
        refs: r.refs.map(nameOf),
        kids: r.kids.map(nameOf),
        ...(r.weakRef === null ? {} : { weakRef: nameOf(r.weakRef) }),
        ...(r.peer === null ? {} : { peer: nameOf(r.peer) }),
      },
      { folders: folderIndex < 0 ? [] : folderChain(folderIndex), location: 'europe-west3-a' },
    );
    if (parent === undefined) delete asset.parent;
    else asset.parent = parent;
    assets.push(asset);
  });
  return assets;
}

function build(spec: OrgSpec, assets = assetsFor(spec), catalog = catalogFor(spec.types)): GraphBuild {
  return GraphBuildSchema.parse(buildGraphWithReport({ assets }, catalog));
}

const RUNS = { numRuns: 150 };

describe('buildGraph properties', () => {
  it('yields a valid, acyclic containment forest and a consistent report for any rules', () => {
    fc.assert(
      fc.property(orgSpec, (spec) => {
        // GraphBuildSchema checks the forest (no cycles, parent/children inverse), resolved vs dangling
        // edges, index ids, and that the report agrees with the graph.
        build(spec);
      }),
      RUNS,
    );
  });

  it('is idempotent and independent of the order of the assets', () => {
    fc.assert(
      fc.property(orgSpec, fc.integer(), (spec, seed) => {
        const assets = assetsFor(spec);
        const catalog = catalogFor(spec.types);
        const first = build(spec, assets, catalog);
        expect(build(spec, assets, catalog)).toEqual(first);
        const shuffled = [...assets]
          .map((asset, index) => ({ asset, key: Math.imul(index + 1, seed | 1) >>> 0 }))
          .sort((a, b) => a.key - b.key)
          .map(({ asset }) => asset);
        expect(build(spec, shuffled, catalog)).toEqual(first);
      }),
      RUNS,
    );
  });

  it('builds with a memo exactly what it builds without one, after any earlier day', () => {
    // A later day of the organisation: each asset kept as the same object, changed (a new object of the same name),
    // removed (resources only), or, for a project, given another id (the project index changes).
    const nextDay = (assets: readonly Asset[], picks: readonly number[]): Asset[] =>
      assets.flatMap((asset, index) => {
        const pick = picks[index % picks.length] ?? 0;
        const data = typeof asset.data === 'object' && asset.data !== null ? asset.data : {};
        if (asset.assetType === PROJECT_TYPE)
          return pick === 0
            ? [{ ...asset, data: { ...data, projectId: `other-${String(index)}` } }]
            : [asset];
        if (!asset.assetType.startsWith(`${SERVICE}/`)) return [asset];
        if (pick === 1) return [];
        if (pick === 2)
          return [{ ...asset, updateTime: '2026-10-02T08:00:00Z', data: { ...data, title: 'x' } }];
        return [asset];
      });
    fc.assert(
      fc.property(
        orgSpec,
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 12 }),
        fc.array(fc.integer({ min: 0, max: 5 }), { minLength: 1, maxLength: 12 }),
        (spec, firstPicks, secondPicks) => {
          const catalog = catalogFor(spec.types);
          const memo = new BuildMemo();
          const withMemo = (assets: readonly Asset[]): GraphBuild =>
            GraphBuildSchema.parse(buildGraphWithReport({ assets }, catalog, { memo }));
          const first = assetsFor(spec);
          const second = nextDay(first, firstPicks);
          const third = nextDay(second, secondPicks);
          // Each day's build without a memo, once: the memo builds revisit the first two days.
          const plain = new Map([first, second, third].map((day) => [day, build(spec, day, catalog)]));
          for (const day of [first, second, third, first, second])
            expect(withMemo(day)).toEqual(plain.get(day));
          // Another catalog object starts the memo afresh.
          const other = catalogFor(spec.types);
          expect(GraphBuildSchema.parse(buildGraphWithReport({ assets: third }, other, { memo }))).toEqual(
            build(spec, third, other),
          );
        },
      ),
      RUNS,
    );
  });

  it('gives every asset exactly one parent, except the organisation, the only root', () => {
    fc.assert(
      fc.property(orgSpec, (spec) => {
        const { graph } = build(spec);
        const listed = new Map<string, number>();
        for (const children of Object.values(graph.containment.children)) {
          for (const child of children) listed.set(child, (listed.get(child) ?? 0) + 1);
        }
        for (const id of Object.keys(graph.nodes)) {
          const hasParent = Object.hasOwn(graph.containment.parent, id);
          expect(listed.get(id) ?? 0).toBe(hasParent ? 1 : 0);
          expect(hasParent).toBe(id !== ORG);
          const parentId = graph.containment.parent[id];
          const node = graph.nodes[id];
          if (parentId !== undefined && node !== undefined && HIERARCHY_TYPES.has(node.assetType)) {
            expect(HIERARCHY_TYPES.has(graph.nodes[parentId]?.assetType ?? '')).toBe(true);
          }
        }
      }),
      RUNS,
    );
  });

  it('never nests across projects, and derives shares exactly from Shared VPC attachments', () => {
    fc.assert(
      fc.property(orgSpec, (spec) => {
        const catalog = catalogFor(spec.types);
        const { graph, report } = build(spec, assetsFor(spec), catalog);
        for (const [child, parentId] of Object.entries(graph.containment.parent)) {
          const a = graph.nodes[child]?.projectNumber;
          const b = graph.nodes[parentId]?.projectNumber;
          if (a !== undefined && b !== undefined) expect(a).toBe(b);
        }
        const shares = new Set(
          graph.edges.filter((e) => e.kind === 'shares').map((e) => `${e.from} ${e.to}`),
        );
        const zoneKindOf = (id: string): CatalogZoneKind | undefined => {
          const assetType = graph.nodes[id]?.assetType ?? '';
          return Object.hasOwn(catalog.types, assetType) ? catalog.types[assetType]?.zoneKind : undefined;
        };
        const hosts = new Set(
          spec.hosts.flatMap((host, index) => (host ? [projectNodeId(projectNumber(index))] : [])),
        );
        for (const id of Object.keys(graph.nodes)) {
          expect(graph.nodes[id]?.sharedVpcHost === true).toBe(hosts.has(id));
        }
        const listed = new Set(
          report.sharedVpc.flatMap((pair) => pair.attachments.map((a) => `${a.from} ${a.to}`)),
        );
        let qualifying = 0;
        for (const edge of graph.edges.filter((e) => e.kind === 'attaches')) {
          const from = graph.nodes[edge.from]?.projectNumber;
          const to = graph.nodes[edge.to]?.projectNumber;
          if (from === undefined || to === undefined || from === to) continue;
          expect(graph.containment.parent[edge.from]).not.toBe(edge.to);
          // Into another project's subnet, or into a Shared VPC host's network.
          const layer = zoneKindOf(edge.to);
          const shared = layer === 'subnet' || (layer === 'vpc' && hosts.has(projectNodeId(to)));
          expect(listed.has(`${edge.from} ${edge.to}`)).toBe(shared);
          if (!shared) continue;
          qualifying += 1;
          expect(shares.has(`${projectNodeId(from)} ${projectNodeId(to)}`)).toBe(true);
        }
        expect(listed.size).toBe(qualifying);
      }),
      RUNS,
    );
  });

  it('lets a weak edge yield exactly when a stronger edge of its kind points inside its target', () => {
    fc.assert(
      fc.property(orgSpec, (spec) => {
        const assets = assetsFor(spec);
        const catalog = catalogFor(spec.types);
        const { graph } = build(spec, assets, catalog);
        const strong = (from: string, kind: string): string[] =>
          graph.edges.filter((e) => e.from === from && e.kind === kind && e.weak !== true).map((e) => e.to);
        // No weak edge that was kept has a stronger edge inside its target.
        for (const edge of graph.edges.filter((e) => e.weak === true)) {
          expect(
            strong(edge.from, edge.kind).some((to) => to !== edge.to && isInside(graph, to, edge.to)),
          ).toBe(false);
        }
        // Every resolved weak relation is either an edge or yielded to a stronger edge inside its target.
        const ctx = { projects: buildProjectIndex(assets) };
        for (const asset of assets) {
          const type = Object.hasOwn(catalog.types, asset.assetType)
            ? catalog.types[asset.assetType]
            : undefined;
          for (const relation of evaluateRelations(asset, type, ctx)) {
            const target = relation.target?.by === 'name' ? relation.target.name : undefined;
            if (relation.weak !== true || relation.kind === 'peers' || target === undefined) continue;
            if (target === asset.name || !Object.hasOwn(graph.nodes, target)) continue;
            const kept = graph.edges.some(
              (e) => e.from === asset.name && e.kind === relation.kind && e.to === target,
            );
            const yielded = strong(asset.name, relation.kind).some((to) => isInside(graph, to, target));
            expect(kept || yielded).toBe(true);
          }
        }
      }),
      RUNS,
    );
  });
});

describe('targeted properties', () => {
  it('breaks any ring of containers that declare each other, reporting it once', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 7 }), fc.integer({ min: 0, max: 6 }), (size, rotation) => {
        const ring = Array.from(
          { length: size },
          (_, i) => `//${SERVICE}/projects/demo-p-1/boxes/ring${String((i + rotation) % size)}`,
        );
        const catalog = catalogFor([
          {
            mapped: true,
            role: 'container',
            containsKids: true,
            byParent: null,
            attachesRefs: false,
            attachesRefsWeak: false,
            attachesWeakRef: false,
            usesRefs: false,
            peers: false,
            zoneKind: 'product',
          },
        ]);
        const assets = [
          organization(),
          project(projectNumber(0), projectId(0)),
          ...ring.map((name, i) =>
            resource(name, typeName(0), projectNumber(0), { title: 'r', kids: [ring[(i + 1) % size]] }),
          ),
        ];
        const { graph, report } = GraphBuildSchema.parse(buildGraphWithReport({ assets }, catalog));
        expect(report.cycles).toHaveLength(1);
        expect([...(report.cycles[0]?.ids ?? [])].sort()).toEqual([...ring].sort());
        const roots = ring.filter((name) => graph.containment.parent[name] === projectName(projectNumber(0)));
        expect(roots).toHaveLength(1);
      }),
      RUNS,
    );
  });

  /**
   * Two projects, project 1 a Shared VPC host or not; each has networks with subnets; instances in project 0
   * pick random NICs anywhere.
   */
  const nicTopology = fc.record({
    xpnHost: fc.boolean(),
    networks: fc.array(fc.tuple(fc.integer({ min: 0, max: 1 }), fc.integer({ min: 0, max: 2 })), {
      minLength: 1,
      maxLength: 4,
    }),
    instances: fc.array(
      fc.array(fc.tuple(fc.nat(), fc.option(fc.nat()), fc.boolean()), { minLength: 1, maxLength: 3 }),
      { minLength: 1, maxLength: 6 },
    ),
  });

  it('applies rule 1, rule 2 and weak precedence to any NIC topology (independent oracle)', () => {
    fc.assert(
      fc.property(nicTopology, ({ xpnHost, networks, instances }) => {
        const ids = [projectId(0), projectId(1)];
        const nets = networks.map(([p, subnetCount], n) => ({
          project: p,
          name: `//compute.googleapis.com/projects/${ids[p] ?? ''}/global/networks/net${String(n)}`,
          subnets: Array.from(
            { length: subnetCount },
            (_, s) =>
              `//compute.googleapis.com/projects/${ids[p] ?? ''}/regions/europe-west3/subnetworks/net${String(n)}-s${String(s)}`,
          ),
        }));
        const link = (name: string): string =>
          name.replace('//compute.googleapis.com/', 'https://www.googleapis.com/compute/v1/');
        const assets: Asset[] = [
          organization(),
          project(projectNumber(0), ids[0] ?? ''),
          project(projectNumber(1), ids[1] ?? ''),
          ...(xpnHost
            ? [
                resource(
                  `//compute.googleapis.com/projects/${ids[1] ?? ''}`,
                  'compute.googleapis.com/Project',
                  projectNumber(1),
                  {
                    name: ids[1],
                    xpnProjectStatus: 'HOST',
                  },
                ),
              ]
            : []),
        ];
        for (const net of nets) {
          assets.push(
            resource(net.name, 'compute.googleapis.com/Network', projectNumber(net.project), {
              name: net.name.split('/').at(-1),
              subnetworks: net.subnets.map(link),
            }),
            ...net.subnets.map((subnet) =>
              resource(subnet, 'compute.googleapis.com/Subnetwork', projectNumber(net.project), {
                name: subnet.split('/').at(-1),
                network: link(net.name),
              }),
            ),
          );
        }
        const expectations = instances.map((nics, i) => {
          const name = `//compute.googleapis.com/projects/${ids[0] ?? ''}/zones/europe-west3-a/instances/vm${String(i)}`;
          const chosen = nics.map(([n, s, withSubnet]) => {
            const net = nets[n % nets.length] ?? nets[0];
            const subnet =
              withSubnet && s !== null && net !== undefined && net.subnets.length > 0
                ? net.subnets[s % net.subnets.length]
                : undefined;
            return { net, subnet };
          });
          assets.push(
            resource(name, 'compute.googleapis.com/Instance', projectNumber(0), {
              name: `vm${String(i)}`,
              networkInterfaces: chosen.map(({ net, subnet }) => ({
                network: link(net?.name ?? ''),
                ...(subnet === undefined ? {} : { subnetwork: link(subnet) }),
              })),
            }),
          );
          // Oracle: subnets are strong, networks weak; a network yields to a subnet inside it.
          const subnets = new Set(chosen.flatMap(({ subnet }) => (subnet === undefined ? [] : [subnet])));
          const networksKept = new Set(
            chosen
              .map(({ net }) => net)
              .filter((net) => net !== undefined && !net.subnets.some((s) => subnets.has(s)))
              .map((net) => net?.name ?? ''),
          );
          const targets = [...subnets, ...networksKept];
          const projectOf = (target: string): number =>
            target.includes(`/projects/${ids[0] ?? ''}/`) ? 0 : 1;
          const parentId =
            targets.length === 1 && projectOf(targets[0] ?? '') === 0
              ? targets[0]
              : projectName(projectNumber(0));
          // A subnet of project 1 is Shared VPC; its network only when project 1 is a Shared VPC host.
          const shares = targets.some(
            (target) => projectOf(target) === 1 && (subnets.has(target) || xpnHost),
          );
          return { name, subnets, networksKept, parentId, shares };
        });
        const { graph } = GraphBuildSchema.parse(
          buildGraphWithReport({ assets }, catalogWith(SCENARIO_COMPUTE)),
        );
        for (const e of expectations) {
          expect(graph.containment.parent[e.name]).toBe(e.parentId);
          const attaches = graph.edges.filter((edge) => edge.from === e.name && edge.kind === 'attaches');
          expect(
            attaches
              .filter((edge) => edge.weak !== true)
              .map((edge) => edge.to)
              .sort(),
          ).toEqual([...e.subnets].sort());
          expect(
            attaches
              .filter((edge) => edge.weak === true)
              .map((edge) => edge.to)
              .sort(),
          ).toEqual([...e.networksKept].sort());
        }
        const shared = graph.edges.some((edge) => edge.kind === 'shares');
        expect(shared).toBe(expectations.some((e) => e.shares));
      }),
      RUNS,
    );
  });
});
