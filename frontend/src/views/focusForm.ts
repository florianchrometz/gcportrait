// SPDX-License-Identifier: MIT
/**
 * The Focus control's kinds and their one parameter each (the model's `FocusSchema` convention:
 * `project` → `{ project }`, `shared-vpc` → `{ host }`, `perimeter` → `{ perimeter }`, `application` →
 * `{ application }`, `standalone-projects` → none), and what the control shows for a focus. Pure.
 */
import type { Focus, FocusKind } from '@gcportrait/model';

import type { ViewChoices } from './choices';

/** The Focus select's value: a focus kind, or none. */
export type FocusChoice = FocusKind | 'none';

export interface FocusKindInfo {
  readonly value: FocusChoice;
  /** The select's option. */
  readonly label: string;
}

/** The select's options, in the order docs/lenses-and-filters.md lists the focus views. */
export const FOCUS_KINDS: readonly FocusKindInfo[] = [
  { value: 'none', label: 'None' },
  { value: 'project', label: 'Single project' },
  { value: 'shared-vpc', label: 'Shared VPC' },
  { value: 'standalone-projects', label: 'Standalone projects' },
  { value: 'perimeter', label: 'Perimeter' },
  { value: 'application', label: 'Application' },
];

export interface FocusParam {
  /** The parameter's name in `focus.params` (and in the hash, `focus.<name>`). */
  readonly name: string;
  /** What the picker and the parameter button call it. */
  readonly title: string;
}

const PARAMS: Readonly<Record<FocusKind, FocusParam | null>> = {
  project: { name: 'project', title: 'Project' },
  'shared-vpc': { name: 'host', title: 'Host project' },
  'standalone-projects': null,
  perimeter: { name: 'perimeter', title: 'Perimeter' },
  application: { name: 'application', title: 'Application' },
};

/** The one parameter a focus kind takes, or null (standalone projects). */
export function focusParamOf(kind: FocusKind): FocusParam | null {
  return PARAMS[kind];
}

/** The focus of a kind with its parameter's value (the value is ignored for a kind without one). */
export function focusOf(kind: FocusKind, value: string | null): Focus {
  const param = focusParamOf(kind);
  return { kind, params: param === null || value === null ? {} : { [param.name]: value } };
}

/** The value of a focus's parameter, or null when it has none (or it is missing). */
export function focusValue(focus: Focus | undefined): string | null {
  if (focus === undefined) return null;
  const param = focusParamOf(focus.kind);
  return param === null ? null : (focus.params[param.name] ?? null);
}

/** One choosable parameter value: what the hash holds, the picker's line and its second line. */
export interface FocusOption {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

/** The values the picker offers for a kind, from the snapshot's choices. */
export function focusOptions(kind: FocusKind, choices: ViewChoices): FocusOption[] {
  switch (kind) {
    case 'project':
      return choices.projects.map((project) => ({
        value: project.id,
        label: project.id,
        description: [project.name, project.path].filter((part) => part !== '').join(' · '),
      }));
    case 'shared-vpc':
      return choices.hosts.map((host) => ({
        value: host.id,
        label: host.id,
        description: `${host.name} · ${String(host.services)} service project${host.services === 1 ? '' : 's'}`,
      }));
    case 'perimeter':
      return choices.perimeters.map((node) => ({
        value: node.node,
        label: node.label,
        description: node.detail,
      }));
    case 'application':
      return choices.applications.map((node) => ({
        value: node.node,
        label: node.label,
        description: node.detail,
      }));
    case 'standalone-projects':
      return [];
  }
}

/**
 * A parameter value as the control shows it: a project's id, a perimeter's or an application's label (its last
 * name segment until the choices arrive, or when the snapshot does not know it).
 */
export function focusValueLabel(kind: FocusKind, value: string, choices: ViewChoices | null): string {
  if (kind === 'perimeter' || kind === 'application') {
    const list = kind === 'perimeter' ? choices?.perimeters : choices?.applications;
    const known = list?.find((node) => node.node === value || node.label === value);
    return known?.label ?? value.slice(value.lastIndexOf('/') + 1);
  }
  const projects = kind === 'shared-vpc' ? choices?.hosts : choices?.projects;
  const known = projects?.find((project) => project.id === value || project.number === value);
  return known?.id ?? value;
}
