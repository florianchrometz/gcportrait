// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useRef } from 'react';
import { Link } from '../router';

import { DiagramCanvas } from '../diagram/DiagramCanvas';
import { DEMO_CHOICES, demoViewHash } from '../diagram/demoChoices';
import { DisclosureBar } from '../diagram/disclosure/DisclosureBar';
import { buildDiagramModel } from '../diagram/model';
import type { DataStage } from '../diagram/pipeline/protocol';
import { useDiagramSession } from '../diagram/session';
import { viewerOffsetMinutes } from '../diagram/titleBlock';
import { DetailsDrawer } from '../drawer/DetailsDrawer';
import { DIAGRAM_CANVAS_ID } from '../keyboard/SkipToCanvas';
import { TimelineKeys } from '../keyboard/TimelineKeys';
import { visibleAreaIn } from '../export/source';
import { DIAGRAM_PATH } from '../routes';
import { withExtraLabel } from '../timeline/extraTicks';
import { useLargeSnapshotGate } from '../snapshots/LargeSnapshotGuard';
import { useAppState, useAppStore, useDiagramActions, useDiagramPipeline, useView } from '../state';
import { rejectedSnapshotRef } from '../views/snapshotRef';
import { usePreference } from '../storage/preferences';
import { useTheme } from '../theme/useTheme';
import styles from './DiagramPage.module.css';
import { TimelineBar } from './diagram/TimelineBar';
import { useDocumentTitle } from './useDocumentTitle';

const STAGE_TEXT: Readonly<Record<DataStage | 'layout', string>> = {
  generate: 'Generating the demo organisation',
  ingest: 'Reading the assets',
  graph: 'Building the graph',
  scene: 'Building the view',
  layout: 'Laying out the diagram',
};

/**
 * The diagram workspace: the canvas, the details drawer (open while a node is selected) and the timeline bar.
 * The view comes from the URL hash through the app store; the store's pipeline
 * draws it (useDiagramPipeline: the canvas measured, the workers asked), once the large-snapshot guard lets it
 * (a snapshot of more than 10 000 assets the person has not chosen to draw yet waits for their answer); selecting
 * a node writes it back there through the store's actions.
 */
export function DiagramPage() {
  useDocumentTitle('Diagram');
  const spec = useView();
  const hash = useAppState((state) => state.view.hash);
  // A link whose `snapshot=` the codec rejected says so, rather than "Nothing to draw yet".
  const rejected = spec.snapshot === '' ? rejectedSnapshotRef(hash) : null;
  const store = useAppStore();
  const actions = useDiagramActions();
  const canvasRef = useRef<HTMLElement>(null);
  // A snapshot of more than 10 000 assets is drawn once the person has said so (the large-snapshot guard).
  const held = useLargeSnapshotGate(spec.snapshot);
  useDiagramPipeline(canvasRef, held);
  const result = useAppState((state) => state.pipeline.result);
  const pending = useAppState((state) => state.pipeline.pending);
  const error = useAppState((state) => state.pipeline.error);
  const selection = useAppState((state) => state.selection.selected);
  const jump = useAppState((state) => state.ui.jump);
  // The panels open over the canvas on a phone or a tablet (the top bar's View or More sheet, the details drawer;
  // never both, state/store.ts `apart`), for the canvas's refit when one opens or closes (DiagramCanvas, `panels`). On
  // a desktop the drawer stands beside the canvas, and the canvas finds that nothing lies over it.
  const panels = useAppState(
    (state) =>
      `${state.ui.sheet ?? ''}|${state.ui.drawerOpen && state.selection.selected !== null ? 'drawer' : ''}`,
  );
  const { resolved: theme } = useTheme();
  const [overlays] = usePreference('diagramOverlays', true);
  const { setExportSource } = useDiagramSession();
  const extras = useAppState((state) => state.timeline.extras);

  const model = useMemo(
    () =>
      result === null
        ? null
        : buildDiagramModel({
            scene: result.answer.scene,
            layout: result.layout,
            lensTitle: result.answer.lensTitle,
            overlayZones: result.answer.report.overlays.map((overlay) => overlay.zone),
            icons: result.answer.icons,
            zoneTypes: result.answer.zoneTypes,
            consoleLinks: result.answer.consoleLinks,
            // The day's markers, when it was compared with the day on screen before it; an extra tick compared
            // with is named by its label ("since export 2026-10-05 14:30").
            ...(result.answer.diff === undefined
              ? {}
              : {
                  diff: {
                    ...result.answer.diff,
                    since: withExtraLabel(result.answer.diff.since, extras),
                  },
                }),
          }),
    [result, extras],
  );

  const offset = result === null ? 0 : viewerOffsetMinutes(result.answer.source.readTime);
  const drawnView = result?.key ?? '';

  // The drawn diagram is what the top bar's Export menu exports.
  useEffect(() => {
    if (model === null) return undefined;
    setExportSource({
      model,
      utcOffsetMinutes: offset,
      visibleArea: () => visibleAreaIn(canvasRef.current),
      view: drawnView,
    });
    return () => {
      setExportSource(null);
    };
  }, [model, offset, drawnView, setExportSource]);

  return (
    <div className={styles.workspace}>
      <h1 className="visually-hidden">Diagram</h1>
      {/* tabIndex -1: the skip link to the diagram focuses the canvas while nothing is drawn. */}
      <section
        ref={canvasRef}
        id={DIAGRAM_CANVAS_ID}
        tabIndex={-1}
        className={styles.canvas}
        aria-label="Diagram canvas"
      >
        {spec.snapshot === '' ? (
          <div className={styles.empty}>
            <h2 className={styles.emptyTitle}>
              {rejected === null ? 'Nothing to draw yet' : 'This link names no snapshot'}
            </h2>
            {rejected === null ? null : (
              <p className={styles.emptyText} role="alert">
                “{rejected}” is not a snapshot: a link names a demo organisation (demo:S, demo:M, demo:L or
                demo:XL) or a snapshot stored in this browser.
              </p>
            )}
            <p className={styles.emptyText}>
              Choose a snapshot from the Snapshot menu, load one from the <Link to="/">Connect</Link> page, or
              open a demo organisation:
            </p>
            <ul className={styles.demoList}>
              {DEMO_CHOICES.map((choice) => (
                <li key={choice.size}>
                  <Link to={{ pathname: DIAGRAM_PATH, hash: demoViewHash(choice.size, spec) }}>
                    {choice.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {model === null ? null : (
          <DiagramCanvas
            model={model}
            theme={theme}
            overlays={overlays}
            utcOffsetMinutes={offset}
            selection={selection}
            onSelect={actions.select}
            onDrillIn={actions.drillIn}
            onHover={store.setHovered}
            jump={jump}
            onJumpDone={store.jumpDone}
            onFlip={actions.flip}
            panels={panels}
          />
        )}
        <DisclosureBar />
        {/* A live region kept in the DOM while idle, so each loading stage is announced. */}
        <p
          className={
            pending === null ? 'visually-hidden' : model === null ? styles.status : styles.statusOverlay
          }
          role="status"
        >
          {pending === null ? '' : `${STAGE_TEXT[pending.stage]}…`}
        </p>
        {error === null ? null : (
          <div className={styles.error} role="alert">
            <h2 className={styles.emptyTitle}>The diagram could not be drawn</h2>
            <p className={styles.emptyText}>{error.message}</p>
            {error.ids.length === 0 ? null : (
              <ul className={styles.errorIds}>
                {error.ids.map((id) => (
                  <li key={id}>
                    <code>{id}</code>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
      <DetailsDrawer model={model} />
      <TimelineBar />
      <TimelineKeys />
    </div>
  );
}
