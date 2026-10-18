// SPDX-License-Identifier: Apache-2.0
import { LENS_IDS, type LensId } from '@gcportrait/model';
import { useEffect, useMemo, type ReactElement } from 'react';

import { humanLensId, useDiagramSession } from '../../diagram/session';
import { useAppState, useDiagramActions, usePopover } from '../../state';
import { Select, type SelectOption } from '../../ui/Select';
import { viewWithLens, type LensDefaults } from '../../views/lensDetail';
import styles from './LensSelect.module.css';

/**
 * The Lens picker: a select-only combobox (ui/Select) over the catalog's eleven lenses,
 * each with its title and description from the lens files through the data worker (the lens ids stand in until
 * they arrive). Choosing one writes the hash through `actions.setView` with views/lensDetail.ts's rule: a
 * detail level that follows the lens (`auto`, or the current lens's own default) becomes `auto`, which opens the
 * new lens at most at its `defaultDetail`, and a level the person chose otherwise stays. Shown on the diagram page
 * only.
 */
export function LensSelect(): ReactElement {
  const { lenses, requestLenses } = useDiagramSession();
  const lens = useAppState((state) => state.view.spec.lens);
  const { setView } = useDiagramActions();
  const [open, setOpen] = usePopover('lens');

  useEffect(() => {
    requestLenses();
  }, [requestLenses]);

  const options: readonly SelectOption<LensId>[] =
    lenses?.map((info) => ({ value: info.id, label: info.title, description: info.description })) ??
    LENS_IDS.map((id) => ({ value: id, label: humanLensId(id) }));
  const defaults = useMemo<LensDefaults>(
    () => Object.fromEntries((lenses ?? []).map((info) => [info.id, info.defaultDetail])),
    [lenses],
  );

  return (
    <Select
      label="Lens"
      options={options}
      value={lens}
      onChange={(next) => {
        setView((spec) => viewWithLens(spec, next, defaults));
      }}
      open={open}
      onOpenChange={setOpen}
      listClassName={styles.list}
    />
  );
}
