// SPDX-License-Identifier: MIT
/**
 * Property tests (fast-check) of canonical name matching and reverse rules: random projects whose assets are
 * named with the project id or the project number, and references that spell the project either way, or name
 * a project the snapshot does not have.
 */
import { GraphBuildSchema, type Asset } from '@gcportrait/model';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildGraphWithReport } from './build.js';
import { catalogWith, organization, project, resource } from './testing/fixtures.js';

const SERVICE = 'boxes.googleapis.com';
const BOX = `${SERVICE}/Box`;
const projectNumber = (index: number): string => String(10000000001 + index);
const projectId = (index: number): string => `demo-p-${String(index + 1)}`;

/** Boxes reference other boxes (`uses`), and name an owner that draws the edge towards them (`reverse`). */
const CATALOG = catalogWith([
  {
    product: 'Boxes',
    service: SERVICE,
    icon: 'boxes',
    types: {
      [BOX]: {
        role: 'core',
        relations: [
          { kind: 'uses', to: '$.data.refs[*]', normalize: 'name' },
          { kind: 'memberOf', to: '$.data.owner', normalize: 'name', reverse: true },
        ],
      },
    },
  },
]);

type Form = 'id' | 'number';

interface BoxSpec {
  readonly project: number;
  readonly box: number;
  /** How the box's own name spells its project. */
  readonly form: Form;
}

interface RefSpec {
  readonly project: number;
  readonly box: number;
  /** `unknown` names a project the snapshot does not have. */
  readonly form: Form | 'unknown';
}

const PROJECTS = 3;
const formOf = fc.constantFrom<Form>('id', 'number');
const refSpec = fc.record({
  project: fc.integer({ min: 0, max: PROJECTS - 1 }),
  box: fc.integer({ min: 0, max: 3 }),
  form: fc.constantFrom<Form | 'unknown'>('id', 'number', 'unknown'),
});
const world = fc.record({
  boxes: fc.uniqueArray(
    fc.record({
      project: fc.integer({ min: 0, max: PROJECTS - 1 }),
      box: fc.integer({ min: 0, max: 3 }),
      form: formOf,
    }),
    { minLength: 1, maxLength: 10, selector: (b) => `${String(b.project)} ${String(b.box)} ${b.form}` },
  ),
  refs: fc.array(fc.array(refSpec, { maxLength: 3 }), { minLength: 10, maxLength: 10 }),
  owners: fc.array(fc.option(refSpec), { minLength: 10, maxLength: 10 }),
});

const projectRef = (project: number, form: Form | 'unknown'): string =>
  form === 'id'
    ? projectId(project)
    : form === 'number'
      ? projectNumber(project)
      : `demo-gone-${String(project)}`;
const boxName = (spec: BoxSpec | RefSpec): string =>
  `//${SERVICE}/projects/${projectRef(spec.project, spec.form)}/boxes/b${String(spec.box)}`;
const relative = (spec: RefSpec): string => boxName(spec).slice(`//${SERVICE}/`.length);

describe('canonical matching by project id or number', () => {
  it('resolves exactly, else with the project swapped once, else dangles with the raw value', () => {
    fc.assert(
      fc.property(world, ({ boxes, refs, owners }) => {
        const assets: Asset[] = [
          organization(),
          ...Array.from({ length: PROJECTS }, (_, p) => project(projectNumber(p), projectId(p))),
          ...boxes.map((box, i) =>
            resource(boxName(box), BOX, projectNumber(box.project), {
              refs: (refs[i] ?? []).map(relative),
              ...(owners[i] === null || owners[i] === undefined ? {} : { owner: relative(owners[i]) }),
            }),
          ),
        ];
        const { graph, report } = GraphBuildSchema.parse(buildGraphWithReport({ assets }, CATALOG));
        const names = new Set(boxes.map(boxName));
        // Asset names are never rewritten.
        for (const name of names) expect(graph.nodes[name]?.id).toBe(name);

        /** The oracle: the name itself, else the same box under the other spelling of a known project. */
        const expected = (ref: RefSpec): { id: string; matchedProject?: Form } | undefined => {
          if (names.has(boxName(ref))) return { id: boxName(ref) };
          if (ref.form === 'unknown') return undefined;
          const other: Form = ref.form === 'id' ? 'number' : 'id';
          const swapped = boxName({ ...ref, form: other });
          return names.has(swapped) ? { id: swapped, matchedProject: other } : undefined;
        };
        boxes.forEach((box, i) => {
          const from = boxName(box);
          for (const ref of refs[i] ?? []) {
            const hit = expected(ref);
            if (hit === undefined) {
              expect(graph.dangling).toContainEqual(
                expect.objectContaining({
                  from,
                  kind: 'uses',
                  to: boxName(ref),
                  dangling: { raw: relative(ref) },
                }),
              );
            } else if (hit.id !== from) {
              const edge = graph.edges.find((e) => e.from === from && e.kind === 'uses' && e.to === hit.id);
              expect(edge).toBeDefined();
              // A copy that matched exactly (another spelling of the same box) wins over a swapped one.
              const exactCopy = (refs[i] ?? []).some((r) => names.has(boxName(r)) && boxName(r) === hit.id);
              expect(edge?.matchedProject).toBe(exactCopy ? undefined : hit.matchedProject);
            }
          }
          const owner = owners[i];
          if (owner === null || owner === undefined) return;
          const hit = expected(owner);
          if (hit === undefined) {
            expect(graph.dangling).toContainEqual(
              expect.objectContaining({ from, kind: 'memberOf', to: boxName(owner) }),
            );
          } else if (hit.id !== from) {
            // A reverse rule's edge runs from the target to the asset holding the reference.
            expect(graph.edges.some((e) => e.from === hit.id && e.kind === 'memberOf' && e.to === from)).toBe(
              true,
            );
          }
        });
        expect(report.counts.projectSwaps).toBe(
          graph.edges.filter((e) => e.matchedProject !== undefined).length,
        );
        for (const edge of graph.edges) {
          if (edge.matchedProject === undefined) continue;
          const spelled =
            /\/projects\/([^/]+)\//.exec(edge.kind === 'memberOf' ? edge.from : edge.to)?.[1] ?? '';
          expect(/^[0-9]+$/.test(spelled) ? 'number' : 'id').toBe(edge.matchedProject);
        }
      }),
      { numRuns: 200 },
    );
  });
});
