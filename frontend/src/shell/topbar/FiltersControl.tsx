// SPDX-License-Identifier: Apache-2.0
import type { ViewFilters } from '@gcportrait/model';
import { useId, useRef, type ReactElement } from 'react';

import { useAppState, useDiagramActions, usePopover, type HistoryMode } from '../../state';
import { Popover } from '../../ui/Popover';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { Slider } from '../../ui/Slider';
import type { ViewChoices } from '../../views/choices';
import {
  activeFilterCount,
  depthFromSlider,
  depthSliderMax,
  depthSliderValue,
  FILTER_LISTS,
  formOf,
  HIDE_SWITCHES,
  NO_FILTERS,
  withFormField,
  withListItem,
  type FilterForm,
  type FilterList,
  type HideSwitch,
  type TriState,
} from '../../views/filterForm';
import { PickerField, type PickerOption } from '../../views/PickerField';
import { useViewChoicesState } from '../../views/useViewChoices';
import controls from '../../ui/controls.module.css';
import styles from './FiltersControl.module.css';

/**
 * The Filters popover (docs/lenses-and-filters.md): every filter of the ViewSpec. The hide switches (empty
 * projects, empty folders, disconnected resources), the regions, projects and folders to keep and the asset
 * types to include or exclude (pickers over the snapshot's own choices; the types from the catalog, searchable
 * by identifier and product), the depth limit, and the region-zone and identity switches. The button's badge
 * counts the active filters; Reset clears them all.
 *
 * There is no form state: the popover shows the view's filters (views/filterForm.ts `formOf`) and every change
 * goes through `actions.setFilters` into the URL hash at once, a history entry each (a depth slider dragged or
 * stepped within a second replaces its own entry). The scene builder applies the filters after the drill-in
 * root and the focus, so they hold under both. Inert until a snapshot is open; shown on the diagram page only.
 */
export function FiltersControl(): ReactElement {
  const hasSnapshot = useAppState((state) => state.view.spec.snapshot !== '');
  return <WorkingFilters inert={hasSnapshot ? undefined : 'Open a snapshot to filter it'} />;
}

const HIDE_LABELS: Readonly<Record<HideSwitch, string>> = {
  hideEmptyProjects: 'Empty projects',
  hideEmptyFolders: 'Empty folders',
  hideDisconnected: 'Disconnected resources',
};

const LIST_LABELS: Readonly<Record<FilterList, string>> = {
  regions: 'Regions',
  projects: 'Projects',
  folders: 'Folders',
  includeTypes: 'Include types',
  excludeTypes: 'Exclude types',
};

const LIST_HINTS: Readonly<Record<FilterList, string>> = {
  regions: 'Keep resources in these locations (a zone counts as its region).',
  projects: 'Keep these projects.',
  folders: 'Keep what lies in these folders.',
  includeTypes: 'Draw these types too, whatever the lens.',
  excludeTypes: 'Never draw these types.',
};

/** Choosable values of each list, from the snapshot's choices. */
function listOptions(choices: ViewChoices | null): Readonly<Record<FilterList, PickerOption[] | null>> {
  if (choices === null) {
    return { regions: null, projects: null, folders: null, includeTypes: null, excludeTypes: null };
  }
  const types = choices.types.map((type) => ({
    value: type.type,
    label: type.type,
    description: `${type.name} · ${type.product} · ${String(type.count)} here`,
  }));
  return {
    regions: choices.regions.map((region) => ({ value: region, label: region })),
    projects: choices.projects.map((project) => ({
      value: project.id,
      label: project.id,
      description: [project.name, project.path].filter((part) => part !== '').join(' · '),
    })),
    folders: choices.folders.map((folder) => ({
      value: folder.number,
      label: folder.label,
      description: [folder.path, folder.number].filter((part) => part !== '').join(' · '),
    })),
    includeTypes: types,
    excludeTypes: types,
  };
}

function TriStateControl({
  label,
  defaultLabel,
  value,
  onChange,
}: {
  readonly label: string;
  readonly defaultLabel: string;
  readonly value: TriState;
  readonly onChange: (value: TriState) => void;
}): ReactElement {
  return (
    <SegmentedControl
      label={label}
      options={[
        { value: 'default', label: defaultLabel },
        { value: 'show', label: 'Show' },
        { value: 'hide', label: 'Hide' },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}

function WorkingFilters({ inert }: { readonly inert: string | undefined }): ReactElement {
  const filters = useAppState((state) => state.view.spec.filters);
  const { setFilters } = useDiagramActions();
  const [open, setOpen] = usePopover('filters');
  const { choices, error: choicesError } = useViewChoicesState();
  const lastDepth = useRef(0);
  const hideId = useId();
  const count = activeFilterCount(filters);
  const form = formOf(filters);
  const depthMax = depthSliderMax(form.depth);
  const options = listOptions(choices);

  const change = (update: (current: ViewFilters) => ViewFilters, history?: HistoryMode): void => {
    setFilters(update, history === undefined ? undefined : { history });
  };
  const set = <K extends keyof FilterForm>(field: K, value: FilterForm[K], history?: HistoryMode): void => {
    change((current) => withFormField(current, field, value), history);
  };
  const depthText = (depth: number): string =>
    depth === 0 ? 'No limit' : `${String(depth)} level${depth === 1 ? '' : 's'} below the root`;

  return (
    <Popover
      label="Filters"
      title="Filters"
      adornment={
        count === 0 ? null : (
          <>
            {/* A space of its own, so every reader names the button "Filters (2 active)". */}{' '}
            <span className={styles.badge} data-testid="filters-badge">
              <span aria-hidden="true">{count}</span>
              <span className="visually-hidden">{`(${String(count)} active)`}</span>
            </span>
          </>
        )
      }
      open={open}
      onOpenChange={setOpen}
      disabled={inert}
    >
      <div className={styles.panel}>
        <div className={styles.column}>
          <fieldset className={styles.fieldset} aria-describedby={hideId}>
            <legend className={styles.legend}>Hide</legend>
            {HIDE_SWITCHES.map((name) => (
              <label key={name} className={styles.check}>
                <input
                  type="checkbox"
                  checked={form[name]}
                  onChange={(event) => {
                    set(name, event.target.checked);
                  }}
                />
                {HIDE_LABELS[name]}
              </label>
            ))}
            <span id={hideId} className={styles.hint}>
              Empty and disconnected in this view, after the lens and the other filters.
            </span>
          </fieldset>
          <div className={styles.depth}>
            {/* Shallow to deep, left to right, "No limit" at the right end. */}
            <Slider
              label="Depth"
              min={1}
              max={depthMax + 1}
              value={depthSliderValue(form.depth)}
              valueText={(position) => depthText(depthFromSlider(position, depthMax))}
              onChange={(position) => {
                // A drag or a run of key presses is one history entry: within a second, replace it.
                const now = Date.now();
                const history: HistoryMode = now - lastDepth.current < 1000 ? 'replace' : 'push';
                lastDepth.current = now;
                set('depth', depthFromSlider(position, depthMax), history);
              }}
            />
            <span className={styles.value} aria-hidden="true">
              {depthText(form.depth)}
            </span>
          </div>
          <TriStateControl
            label="Region zones"
            defaultLabel="Default"
            value={form.showRegions}
            onChange={(value) => {
              set('showRegions', value);
            }}
          />
          <TriStateControl
            label="Identities"
            defaultLabel="Lens"
            value={form.showIdentities}
            onChange={(value) => {
              set('showIdentities', value);
            }}
          />
          <div className={styles.footer}>
            <span className={styles.count} role="status">
              {count === 0 ? 'No filters active' : `${String(count)} active`}
            </span>
            <button
              type="button"
              className={controls.control}
              onClick={() => {
                change(() => NO_FILTERS);
              }}
            >
              Reset filters
            </button>
          </div>
        </div>
        <div className={styles.column}>
          {choicesError === null ? null : (
            // The pickers cannot list anything (they said "Loading" for good): why, once, above them.
            <p className={styles.error} role="alert">
              {choicesError} Its regions, projects, folders and types cannot be listed.
            </p>
          )}
          {FILTER_LISTS.map((list) => (
            <PickerField
              key={list}
              label={LIST_LABELS[list]}
              hint={LIST_HINTS[list]}
              values={form[list]}
              options={options[list]}
              unavailable={choicesError}
              onAdd={(value) => {
                change((current) => withListItem(current, list, value, true));
              }}
              onRemove={(value) => {
                change((current) => withListItem(current, list, value, false));
              }}
            />
          ))}
        </div>
      </div>
    </Popover>
  );
}
