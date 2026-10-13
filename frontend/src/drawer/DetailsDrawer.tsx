// SPDX-License-Identifier: MIT
/**
 * The details drawer: beside the canvas while a node is selected (and
 * `ui.drawerOpen`). Its header names the node (icon, type, display name, product) and offers "Drill in" for a
 * container and "Open in Cloud Console ↗" (the catalog engine's console link, the same action as the card's and
 * its menu's); below it the node's name with a copy button, its parent, project and location, addresses and
 * domains to copy, labels and tags, its relations grouped by kind in the model's order with a jump link per
 * target, its dangling references with their raw values, and a "Raw JSON" toggle with `resource.data`. While the
 * diagram is a timeline day compared with the day on screen before it, a "What changed" section
 * (WhatChanged.tsx) says what changed about the node between the two days.
 *
 * The details come from the data worker (useNodeDetails, per day drawn; useNodeChanges); the selection itself
 * stays in the URL hash, and every
 * change goes through the store's actions: a jump link selects its target, first opening the collapsed zones
 * around it (a `reveal` request, drawer/reveal.ts) when it is hidden in a chip. Opening the drawer or changing the
 * selection asks the canvas for a short pan (`jumpTo(id, { mode: 'reveal' })`) that keeps the node and its trace
 * clear of the drawer; it never lays the diagram out again. Escape and Close clear the selection and give focus
 * back to the node on the canvas. The width (360–420 px) follows the handle on the left edge and is kept in the
 * preferences.
 *
 * Narrower than a desktop (ui/screen.ts) the drawer lies over the canvas instead of beside it: on a tablet a panel
 * along its right edge, on a phone a sheet over its lower half, which its handle (the top edge) takes up to the whole
 * height and back to half, so the upper half of the canvas stays in view while it is open at half height; it opens
 * at half height each time. Its header and details then scroll together inside it, so nothing it holds ever reaches
 * past its edge whatever its height. Both close as the drawer does (Close, Escape), the phone's sheet also when its
 * handle is dragged down well below half and let go (dragged down, the sheet follows the finger, and fades once
 * letting go would close it). The canvas's camera keeps the node in the part of the canvas the
 * drawer leaves in view (`data-canvas-overlay`); the sheet's `data-sheet` (`half`, `full`) tells the page's
 * stylesheets where it is: what floats over the canvas moves above the sheet at half height, and the canvas's content
 * is hidden while the sheet covers it at full height (pages/DiagramPage.module.css), so no focus lands out of sight.
 */
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';

import { canDrillIn, consoleAction, consoleActionOf, type ConsoleAction } from '../diagram/actions';
import { canvasOf, parkCanvasFocus } from '../diagram/canvasFocus';
import { collapseButtonOf } from '../diagram/disclosure/CollapseButton';
import { iconKeyOf, lookupIcon } from '../diagram/icons';
import { relationLabel } from '../diagram/legend';
import type { DiagramModel } from '../diagram/model';
import { cardTypeName } from '../diagram/names';
import { nodeElement } from '../diagram/painter';
import { ICON_PLATE } from '../diagram/theme/tokens';
import { ZONE_KIND_NAMES } from '../diagram/theme/styles';
import { useDiagramSession } from '../diagram/session';
import { viewerOffsetMinutes } from '../diagram/titleBlock';
import {
  FALLBACK_VIEWPORT,
  sceneKey,
  selectDrawnDay,
  useAppState,
  useAppStore,
  useDiagramActions,
} from '../state';
import { DIAGRAM_CANVAS_ID } from '../keyboard/SkipToCanvas';
import { DRAWER_WIDTH, usePreference } from '../storage/preferences';
import { useTheme } from '../theme/useTheme';
import { useScreen } from '../ui/screen';
import { withExtraLabel } from '../timeline/extraTicks';
import { CopyButton } from './CopyButton';
import styles from './DetailsDrawer.module.css';
import { JumpLink } from './JumpLink';
import { clampHeight, dismissing, ResizeHandle, SHEET_HEIGHT } from './ResizeHandle';
import {
  danglingExplanation,
  DIRECTION_ARROWS,
  DIRECTION_WORDS,
  noGhostText,
  notDrawnText,
  removedNodeNote,
} from './text';
import type { NodeChanges, NodeDetails, NodeRef, RelationGroup } from './types';
import { useNodeChanges } from './useNodeChanges';
import { useNodeDetails } from './useNodeDetails';
import { changesSince, WhatChanged } from './WhatChanged';

/** What the header shows before (or without) the worker's details: the Scene node's own facts. */
interface Heading {
  readonly label: string;
  readonly typeName: string;
  readonly product?: string;
  readonly subtitle?: string;
}

function headingOf(
  model: DiagramModel | null,
  id: string,
  details: NodeDetails | null,
  changes: NodeChanges | null,
): Heading {
  if (details !== null) {
    return {
      label: details.label,
      typeName: details.typeName,
      product: details.product,
      ...(details.subtitle === undefined ? {} : { subtitle: details.subtitle }),
    };
  }
  const node = model?.nodes.get(id);
  // A removed node the view draws no ghost of: as the day compared with had it.
  if (node === undefined && changes !== null) return { label: changes.label, typeName: changes.typeName };
  if (node === undefined) return { label: id.slice(id.lastIndexOf('/') + 1) || id, typeName: '' };
  const typeName =
    node.type === 'card'
      ? cardTypeName(node.product, node.assetType)
      : (model?.input.zoneTypes?.[id] ?? ZONE_KIND_NAMES[node.kind]);
  return {
    label: node.label,
    typeName,
    ...(node.type === 'card' ? { product: node.product } : {}),
    ...(node.subtitle === undefined ? {} : { subtitle: node.subtitle }),
  };
}

/** The icon the canvas draws for the node (its card's, or its zone's header mark); the generic mark otherwise. */
function NodeIcon({
  model,
  id,
}: {
  readonly model: DiagramModel | null;
  readonly id: string;
}): ReactElement | null {
  const { resolved } = useTheme();
  if (model === null) return null;
  const rect = model.input.layout.rects[id];
  const icon = lookupIcon(
    model.input.icons,
    rect === undefined ? undefined : iconKeyOf(model.nodes.get(id), rect),
  );
  const plate = resolved === 'dark' && icon.plateOnDark;
  return (
    <span
      className={styles.icon}
      style={
        plate
          ? {
              backgroundColor: `color-mix(in srgb, ${ICON_PLATE.fill} ${String(ICON_PLATE.opacity * 100)}%, transparent)`,
              borderRadius: ICON_PLATE.radius,
            }
          : undefined
      }
    >
      <img
        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(icon.svg)}`}
        alt=""
        width={32}
        height={32}
      />
    </span>
  );
}

function Relations({
  groups,
  onJump,
}: {
  readonly groups: readonly RelationGroup[];
  readonly onJump: (target: NodeRef) => void;
}): ReactElement {
  const headingId = useId();
  const count = groups.reduce((sum, group) => sum + group.entries.length + group.more, 0);
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.sectionTitle}>
        Relations <span className={styles.count}>({count})</span>
      </h3>
      {groups.length === 0 ? (
        <p className={styles.note}>No relations to other assets.</p>
      ) : (
        groups.map((group) => (
          <div key={group.kind} className={styles.group} data-kind={group.kind}>
            <h4 className={styles.groupTitle}>{relationLabel(group.kind)}</h4>
            <ul className={styles.relations}>
              {group.entries.map((entry) => (
                <li key={`${entry.direction} ${entry.target.id}`} className={styles.relation}>
                  <span className={styles.arrow} aria-hidden="true">
                    {DIRECTION_ARROWS[entry.direction]}
                  </span>
                  <span className="visually-hidden">{DIRECTION_WORDS[entry.direction]} </span>
                  <JumpLink target={entry.target} onJump={onJump} />
                  {entry.target.typeName === '' ? null : (
                    <span className={styles.typeName}> {entry.target.typeName}</span>
                  )}
                  {entry.via === undefined ? null : (
                    <span className={styles.muted}>
                      {' · in '}
                      <JumpLink target={entry.via} onJump={onJump} />
                    </span>
                  )}
                  {entry.weak === true ? <span className={styles.muted}> · weak</span> : null}
                </li>
              ))}
            </ul>
            {group.more === 0 ? null : (
              <p className={styles.note}>and {group.more} more (open Details to see them all)</p>
            )}
          </div>
        ))
      )}
    </section>
  );
}

function Dangling({ details }: { readonly details: NodeDetails }): ReactElement | null {
  const headingId = useId();
  if (details.dangling.length === 0) return null;
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.sectionTitle}>
        Dangling references <span className={styles.count}>({details.dangling.length})</span>
      </h3>
      <p className={styles.note}>
        References that name nothing in this snapshot; the diagram does not draw them.
      </p>
      <ul className={styles.dangling}>
        {details.dangling.map((entry) => (
          <li key={`${entry.kind} ${entry.to}`} className={styles.danglingEntry}>
            <span className={styles.kind}>{entry.kind}</span>{' '}
            <code className={styles.value}>{entry.raw}</code>
            <p className={styles.explanation}>{danglingExplanation(entry)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RawJson({
  details,
  open,
  onToggle,
  onStatus,
}: {
  readonly details: NodeDetails;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly onStatus: (text: string) => void;
}): ReactElement | null {
  const headingId = useId();
  const codeId = useId();
  if (details.resource === null) return null;
  // Data that crossed `postMessage` holds no functions or symbols; only undefined has no JSON text.
  const { data } = details.resource;
  const json = data === undefined ? 'undefined' : JSON.stringify(data, null, 2);
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <div className={styles.rowBetween}>
        <h3 id={headingId} className={styles.sectionTitle}>
          Raw JSON
        </h3>
        <div className={styles.row}>
          <button
            type="button"
            className={styles.button}
            aria-expanded={open}
            aria-controls={codeId}
            onClick={onToggle}
          >
            {open ? 'Hide resource.data' : 'Show resource.data'}
          </button>
          {open ? <CopyButton value={json} label="Copy JSON" what="the JSON" onStatus={onStatus} /> : null}
        </div>
      </div>
      <pre id={codeId} className={styles.json} hidden={!open}>
        <code>{open ? json : ''}</code>
      </pre>
    </section>
  );
}

function Facts({
  details,
  onJump,
  onStatus,
}: {
  readonly details: NodeDetails;
  readonly onJump: (target: NodeRef) => void;
  readonly onStatus: (text: string) => void;
}): ReactElement {
  const { project } = details;
  return (
    <>
      {details.parent === undefined ? null : (
        <>
          <dt>Parent</dt>
          <dd>
            <JumpLink target={details.parent} onJump={onJump} />
            <span className={styles.typeName}> {details.parent.typeName}</span>
          </dd>
        </>
      )}
      {project === undefined ? null : (
        <>
          <dt>Project</dt>
          <dd>
            {project.node === undefined ? (
              <span>{project.id ?? project.number}</span>
            ) : (
              <JumpLink
                target={{
                  id: project.node,
                  label: project.id ?? project.number ?? project.node,
                  typeName: '',
                }}
                onJump={onJump}
              />
            )}
            {project.id !== undefined && project.number !== undefined ? (
              <span className={styles.muted}> · {project.number}</span>
            ) : null}
          </dd>
        </>
      )}
      {details.location === undefined ? null : (
        <>
          <dt>Location</dt>
          <dd>{details.location}</dd>
        </>
      )}
      {details.ips.length === 0 ? null : (
        <>
          <dt>IP addresses</dt>
          <dd>
            <ul className={styles.values}>
              {details.ips.map((ip) => (
                <li key={ip}>
                  <code className={styles.value}>{ip}</code>
                  <CopyButton value={ip} label={`Copy ${ip}`} what={ip} onStatus={onStatus} />
                </li>
              ))}
            </ul>
          </dd>
        </>
      )}
      {details.domains.length === 0 ? null : (
        <>
          <dt>Domains</dt>
          <dd>
            <ul className={styles.values}>
              {details.domains.map((domain) => (
                <li key={domain}>
                  <code className={styles.value}>{domain}</code>
                  <CopyButton value={domain} label={`Copy ${domain}`} what={domain} onStatus={onStatus} />
                </li>
              ))}
            </ul>
          </dd>
        </>
      )}
      {details.labels.length === 0 ? null : (
        <>
          <dt>Labels</dt>
          <dd>
            <ul className={styles.badges}>
              {details.labels.map((label) => (
                <li key={label.key} className={styles.badge}>
                  <span className={styles.badgeKey}>{label.key}</span>: {label.value}
                </li>
              ))}
            </ul>
          </dd>
        </>
      )}
      {details.tags.length === 0 ? null : (
        <>
          <dt>Tags</dt>
          <dd>
            <ul className={styles.badges}>
              {details.tags.map((tag) => (
                <li key={tag} className={styles.badge}>
                  {tag}
                </li>
              ))}
            </ul>
          </dd>
        </>
      )}
    </>
  );
}

/** Puts keyboard focus on the node on the canvas (it becomes the drawing's tab stop), or on the canvas. */
function focusCanvas(from: Element | null, id: string | null): void {
  const svg = from?.ownerDocument.querySelector<SVGSVGElement>('svg.dg-canvas') ?? null;
  if (svg === null) return;
  const element = id === null ? null : nodeElement(svg, id);
  // An open zone takes focus on its collapse button, the item the keyboard knows it by.
  const target =
    element instanceof SVGElement && element.getAttribute('role') !== 'button' && id !== null
      ? collapseButtonOf(svg, id)
      : element;
  if (target instanceof SVGElement && target.getAttribute('role') === 'button') target.focus();
  else svg.focus();
}

export function DetailsDrawer({ model }: { readonly model: DiagramModel | null }): ReactElement {
  const selection = useAppState((state) => state.selection.selected);
  const open = useAppState((state) => state.ui.drawerOpen);
  const snapshot = useAppState((state) => state.view.spec.snapshot);
  const store = useAppStore();
  const actions = useDiagramActions();
  const { workers } = useDiagramSession();
  const [storedWidth, storeWidth] = usePreference('drawerWidth', DRAWER_WIDTH.min);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  // The phone's sheet: its height in percent of the canvas's (half to full), while dragged and as left.
  const sheet = useScreen() === 'phone';
  const [height, setHeight] = useState<number>(SHEET_HEIGHT.min);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const [rawOpen, setRawOpen] = useState(false);
  const [status, setStatus] = useState<{ readonly id: string; readonly text: string } | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  const drawerId = useId();
  const titleId = useId();
  // The day drawn and, when it was compared with the day on screen before it, that diff.
  const drawnDay = useAppState((state) => state.pipeline.result?.answer.source.tick);
  const drawnReadTime = useAppState((state) => state.pipeline.result?.answer.source.readTime);
  const diff = useAppState((state) => state.pipeline.result?.answer.diff);
  const visible = selection !== null && open;
  const state = useNodeDetails(snapshot, drawnDay, visible ? selection : null);
  const details = state.status === 'ready' ? state.value : null;
  const asked = useNodeChanges(
    snapshot,
    diff === undefined ? null : { since: { tick: diff.since.tick ?? null }, day: { tick: drawnDay ?? null } },
    visible ? selection : null,
  );
  // An extra tick compared with is named by its label, as the diagram's legend names it.
  const extras = useAppState((state) => state.timeline.extras);
  const changesState = useMemo(
    () =>
      asked.status === 'ready' && asked.value !== null
        ? { ...asked, value: { ...asked.value, since: withExtraLabel(asked.value.since, extras) } }
        : asked,
    [asked, extras],
  );
  const changes = changesState.status === 'ready' ? changesState.value : null;
  const offset = drawnReadTime === undefined ? 0 : viewerOffsetMinutes(drawnReadTime);
  const width = dragWidth ?? storedWidth;
  const sheetHeight = dragHeight ?? height;

  // The sheet opens at half height each time.
  useEffect(() => {
    if (!visible) setHeight(SHEET_HEIGHT.min);
  }, [visible]);

  // Opening the drawer or selecting another node keeps the node and its trace in view beside the drawer: a
  // short pan of the camera, never a new layout (the canvas waits until the node is drawn). While the phone's sheet
  // covers the canvas (full height) the pan waits, and comes when the sheet goes back down to half.
  const covering = sheet && height >= SHEET_HEIGHT.max;
  useEffect(() => {
    if (visible && !covering) actions.jumpTo(selection, { mode: 'reveal' });
  }, [visible, selection, actions, covering]);

  const say = useCallback(
    (text: string): void => {
      const id = store.getState().selection.selected;
      if (id !== null) setStatus({ id, text });
    },
    [store],
  );

  const close = useCallback((): void => {
    const id = store.getState().selection.selected;
    actions.select(null);
    focusCanvas(asideRef.current, id);
  }, [store, actions]);

  const jump = useCallback(
    (target: NodeRef): void => {
      const before = store.getState();
      if (model?.nodes.has(target.id) === true) {
        actions.select(target.id);
        return;
      }
      const client = workers()?.data;
      if (client === undefined) {
        actions.select(target.id);
        return;
      }
      const key = sceneKey(before.view.spec);
      // The day on screen: the flips are worked out on the Graph of the day drawn.
      const day = { tick: selectDrawnDay(before) ?? null };
      client.reveal(before.view.spec, before.pipeline.viewport ?? FALLBACK_VIEWPORT, target.id, day).then(
        (answer) => {
          const now = store.getState();
          // The view changed meanwhile: the flips were worked out for another one.
          if (sceneKey(now.view.spec) !== key) return;
          const same =
            answer.flips.length === now.view.spec.flips.length &&
            answer.flips.every((flip, index) => now.view.spec.flips[index] === flip);
          if (answer.shown && !same) {
            actions.setView((current) => ({ ...current, flips: [...answer.flips], selection: target.id }));
          } else {
            actions.select(target.id);
          }
          if (!answer.shown) setStatus({ id: target.id, text: notDrawnText(target.label) });
        },
        () => {
          actions.select(target.id);
        },
      );
    },
    [store, actions, model, workers],
  );

  // A removed node: its ghost is selected when the view draws one (the reveal pan brings it into view);
  // otherwise it is selected all the same, so the drawer shows how it was, and the status line says why nothing is
  // drawn.
  const jumpRemoved = useCallback(
    (target: NodeRef): void => {
      actions.select(target.id);
      if (model?.nodes.has(target.id) !== true && diff !== undefined) {
        const since = changesSince(
          { since: diff.since, readTime: drawnReadTime ?? diff.since.readTime },
          offset,
        );
        setStatus({ id: target.id, text: noGhostText(target.label, since) });
      }
    },
    [actions, model, diff, drawnReadTime, offset],
  );

  const commitWidth = (next: number): void => {
    setDragWidth(null);
    storeWidth(next);
    const id = store.getState().selection.selected;
    if (id !== null) actions.jumpTo(id, { mode: 'reveal' });
  };

  // The sheet's height as it settled; back at half from full, the effect above pans to the node again.
  const commitHeight = (next: number): void => {
    setDragHeight(null);
    setHeight(clampHeight(next));
  };

  // One percent of the sheet's height in CSS px: the canvas's height over 100.
  const pixelsPerPercent = (): number =>
    (asideRef.current?.ownerDocument.getElementById(DIAGRAM_CANVAS_ID)?.clientHeight ?? 0) / 100;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    close();
  };

  const id = selection ?? '';
  const heading = headingOf(model, id, details, changes);
  const removed = changes?.status === 'removed' || model?.diff?.ghosts.get(id) === 'removed';
  const action: ConsoleAction | undefined =
    details?.console === undefined
      ? model === null || selection === null
        ? undefined
        : consoleActionOf(model, selection)
      : consoleAction(details.console, details.label);
  const drillable =
    details === null
      ? model !== null && selection !== null && canDrillIn(model, selection)
      : details.drillable;

  return (
    <aside
      ref={asideRef}
      id={drawerId}
      className={styles.drawer}
      aria-label="Details"
      // Over the canvas on a phone or a tablet: the canvas's camera keeps a node clear of it (diagram/DiagramCanvas).
      data-canvas-overlay=""
      hidden={!visible}
      data-sheet={sheet ? (sheetHeight >= SHEET_HEIGHT.max ? 'full' : 'half') : undefined}
      // Dragged down far enough that letting go closes it: the sheet fades (DetailsDrawer.module.css).
      data-dismissing={sheet && dragHeight !== null && dismissing(dragHeight) ? '' : undefined}
      style={sheet ? { height: `${String(sheetHeight)}%` } : { width }}
      onKeyDown={onKeyDown}
    >
      {sheet ? (
        <ResizeHandle
          axis="height"
          value={sheetHeight}
          controls={drawerId}
          pixelsPerUnit={pixelsPerPercent}
          onChange={setDragHeight}
          onCommit={commitHeight}
          onDismiss={() => {
            setDragHeight(null);
            close();
          }}
        />
      ) : (
        <ResizeHandle value={width} controls={drawerId} onChange={setDragWidth} onCommit={commitWidth} />
      )}
      {selection === null ? null : (
        // One box for the header and the details: the drawer's grid on a desktop, what scrolls on narrower screens.
        <div className={styles.content}>
          <div className={styles.header}>
            <div className={styles.titleRow}>
              <NodeIcon model={model} id={selection} />
              <div className={styles.titles}>
                {heading.typeName === '' ? null : <p className={styles.type}>{heading.typeName}</p>}
                <h2 id={titleId} className={styles.title}>
                  {heading.label}
                </h2>
                {heading.product === undefined && heading.subtitle === undefined ? null : (
                  <p className={styles.product}>
                    {[heading.product, heading.subtitle].filter((part) => part !== undefined).join(' · ')}
                  </p>
                )}
              </div>
              <button type="button" className={styles.button} onClick={close}>
                Close
              </button>
            </div>
            {drillable || action !== undefined ? (
              <div className={styles.actions}>
                {drillable ? (
                  <button
                    type="button"
                    className={styles.primary}
                    onClick={() => {
                      actions.drillIn(selection);
                      // The drawer goes with the selection: focus waits on the canvas and goes to the drilled-in
                      // view's tab stop once it is drawn, as after the node menu's "Drill in".
                      const svg = canvasOf(asideRef.current?.ownerDocument ?? document);
                      if (svg !== null) parkCanvasFocus(svg);
                    }}
                  >
                    Details
                  </button>
                ) : null}
                {action === undefined ? null : (
                  <a
                    className={styles.button}
                    href={action.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${action.label} (opens a new tab)`}
                    data-console={action.kind}
                  >
                    {action.label}
                    <span aria-hidden="true">&nbsp;↗</span>
                  </a>
                )}
              </div>
            ) : null}
            <p className={styles.status} role="status">
              {status?.id === selection ? status.text : ''}
            </p>
          </div>
          <div className={styles.body}>
            <dl className={styles.facts}>
              <dt>Name</dt>
              <dd className={styles.nameRow}>
                <code className={styles.value}>{selection}</code>
                <CopyButton
                  value={selection}
                  label="Copy resource name"
                  what="the resource name"
                  onStatus={say}
                />
              </dd>
              {details === null ? null : (
                <>
                  <dt>Asset type</dt>
                  <dd>
                    <code className={styles.value}>{details.assetType}</code>
                  </dd>
                  <Facts details={details} onJump={jump} onStatus={say} />
                </>
              )}
            </dl>
            {state.status === 'loading' ? <p className={styles.note}>Loading the details…</p> : null}
            {state.status === 'error' ? (
              <p className={styles.note} role="alert">
                The details could not be read: {state.message}
              </p>
            ) : null}
            {state.status === 'ready' && details === null ? (
              <p className={styles.note}>
                {removed && changes !== null
                  ? removedNodeNote(changesSince(changes, offset))
                  : 'Not an asset of the snapshot: the diagram draws this zone to group what is inside it.'}
              </p>
            ) : null}
            <WhatChanged
              state={changesState}
              utcOffsetMinutes={offset}
              onJump={jump}
              onJumpRemoved={jumpRemoved}
            />
            {details === null ? null : (
              <>
                <Relations groups={details.relations} onJump={jump} />
                <Dangling details={details} />
                <RawJson
                  details={details}
                  open={rawOpen}
                  onToggle={() => {
                    setRawOpen((value) => !value);
                  }}
                  onStatus={say}
                />
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
