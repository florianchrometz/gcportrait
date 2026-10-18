// SPDX-License-Identifier: Apache-2.0
import type { SnapshotRef, SnapshotSourceKind } from '@gcportrait/model';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router';

import type { SceneSource } from '../../diagram/pipeline/protocol';
import { formatUtc as formatReadTime } from '../../snapshots/labels';
import { useAppState, useDiagramActions, usePopover } from '../../state';
import type { MenuItem } from '../../ui/Menu';
import { MenuButton } from '../../ui/MenuButton';
import type { SnapshotFacts } from '../../views/choices';
import { useViewChoices } from '../../views/useViewChoices';

export { formatUtc as formatReadTime } from '../../snapshots/labels';

const SOURCE_WORDS: Readonly<Record<SnapshotSourceKind, string>> = {
  demo: 'demo organisation',
  api: 'API pull',
  export: 'export file',
};

/**
 * The line that says which snapshot is open: its scope, read time and source ("example.com · read 2026-10-08
 * 00:00 UTC · demo organisation"), from the view choices when they have arrived (they know the source and
 * whether the read time is an estimate), else from the drawn diagram; null when no snapshot is open.
 */
export function currentSnapshotLine(
  ref: SnapshotRef,
  facts: SnapshotFacts | null,
  source: SceneSource | null,
): string | null {
  if (ref === '') return null;
  if (facts !== null && facts.ref === ref) {
    const read = `read ${formatReadTime(facts.readTime)}${facts.readTimeEstimated ? ' (estimated)' : ''}`;
    return `${facts.scope} · ${read} · ${SOURCE_WORDS[facts.source]}`;
  }
  if (source !== null && source.ref === ref) {
    const kind = ref.startsWith('demo:') ? ` · ${SOURCE_WORDS.demo}` : '';
    return `${source.scope} · read ${formatReadTime(source.readTime)}${kind}`;
  }
  return null;
}

/**
 * The Snapshot menu: a menu button (ui/MenuButton). While a snapshot is open, its first
 * item says which (scope, read time, source; announced as unavailable, it does nothing); then the snapshots on offer as
 * radio items (`snapshot.available`: the demo organisations and the stored snapshots), the open
 * one checked, which open another snapshot through `actions.setSnapshot` (lens and detail level kept); last, the
 * Snapshots page (the router's navigation, not a view change). `onPick` follows a snapshot's pick (the top bar
 * closes its More sheet).
 */
export function SnapshotMenu({ onPick }: { readonly onPick?: () => void }): ReactElement {
  const available = useAppState((state) => state.snapshot.available);
  const current = useAppState((state) => state.view.spec.snapshot);
  const source = useAppState((state) => state.snapshot.source);
  const choices = useViewChoices();
  const { setSnapshot } = useDiagramActions();
  const navigate = useNavigate();
  const [open, setOpen] = usePopover('snapshot');
  const line = currentSnapshotLine(current, choices?.snapshot ?? null, source);

  const items: MenuItem[] = [
    ...(line === null ? [] : [{ id: 'current', label: `Open: ${line}`, disabled: true }]),
    ...available.map((choice): MenuItem => ({
      id: choice.ref,
      label: choice.label,
      kind: 'radio',
      checked: choice.ref === current,
      onSelect: () => {
        setSnapshot(choice.ref);
        onPick?.();
      },
    })),
    {
      id: 'snapshots-page',
      label: 'Snapshots page',
      onSelect: () => {
        void navigate('/snapshots');
      },
    },
  ];

  return <MenuButton label="Snapshot" align="end" open={open} onOpenChange={setOpen} items={items} />;
}
