// SPDX-License-Identifier: Apache-2.0
import type { ConcreteDetailLevel, DetailLevel, SceneDetail } from '@gcportrait/model';
import type { ReactElement } from 'react';

import { autoLevel } from '../../diagram/autoDetail';
import { useAppState, useDiagramActions, useScene } from '../../state';
import { SegmentedControl, type SegmentedOption } from '../../ui/SegmentedControl';
import styles from './DetailControl.module.css';

const LEVEL_LABELS: Readonly<Record<ConcreteDetailLevel, string>> = {
  folders: 'Folders',
  projects: 'Projects',
  networks: 'Networks',
  all: 'All',
};

/**
 * The level `auto` picks for the view on screen (layout skill §6): the level the scene builder used when the view
 * asks for `auto`, else the one it would pick from the report's rect counts, budget and lens ceiling
 * (diagram/autoDetail.ts, the builder's own rule). Null while nothing is drawn.
 */
export function autoPick(detail: SceneDetail | undefined): ConcreteDetailLevel | null {
  if (detail === undefined) return null;
  return detail.requested === 'auto' ? detail.used : autoLevel(detail, detail.budget);
}

/** The control's options: Auto names the level it picks ("Auto · folders") once a diagram is drawn. */
export function detailOptions(auto: ConcreteDetailLevel | null): SegmentedOption<DetailLevel>[] {
  return [
    { value: 'auto', label: auto === null ? 'Auto' : `Auto · ${LEVEL_LABELS[auto].toLowerCase()}` },
    ...(['folders', 'projects', 'networks', 'all'] as const).map((level) => ({
      value: level,
      label: LEVEL_LABELS[level],
    })),
  ];
}

/**
 * The detail control (layout skill §6; a segmented control, auto / folders / projects / networks / all).
 * Choosing a level writes it into the hash (`actions.setDetail`, a history entry); Auto shows which level
 * it picked for the canvas, which is never deeper than the lens's own default. A lens switch may change
 * the level (views/lensDetail.ts). Shown on the diagram page only.
 */
export function DetailControl(): ReactElement {
  const detail = useAppState((state) => state.view.spec.detail);
  const { setDetail } = useDiagramActions();
  const auto = autoPick(useScene()?.report.detail);
  return (
    <span className={styles.detail}>
      <SegmentedControl
        label="Detail"
        options={detailOptions(auto)}
        value={detail}
        onChange={(level) => {
          setDetail(level);
        }}
      />
    </span>
  );
}
