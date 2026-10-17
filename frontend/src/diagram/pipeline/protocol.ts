// SPDX-License-Identifier: MIT
/**
 * The data worker's protocol (ingest and graph build off the UI thread). The page asks for
 * the lens list or for the Scene of a view; the worker loads the view's snapshot (a demo organisation, generated
 * by `@gcportrait/demo-data` and read by `@gcportrait/ingest`, or a snapshot stored in IndexedDB), builds its
 * Graph once (`@gcportrait/graph` with the compiled catalog), keeps it, and answers each view with its Scene and
 * report, the icons the Scene draws, the type names of its product-container zones and its nodes' console links.
 * The `demo` request prepares a demo organisation for the snapshot library ("Try the demo"); the page
 * sends it to a worker started for the job (demoRole.ts, the same protocol), so the data worker's requests never
 * wait behind it; the demo generator runs in workers only. The layout runs in its own worker
 * (`@gcportrait/layout`'s protocol).
 */
import type { ConsoleLink } from '@gcportrait/catalog';
import type {
  DemoSize,
  DetailLevel,
  LensId,
  Scene,
  SceneReport,
  SnapshotRef,
  ViewSpec,
} from '@gcportrait/model';

import type { NodeChanges, NodeDetails } from '../../drawer/types';
import type { LocateAnswer, LocateQuery, SearchAnswer, SearchQuery } from '../../search/protocol';
import type { ViewChoices } from '../../views/choices';
import type { JobProgress, PreparedSnapshot } from '../../snapshots/worker/protocol';
import type { TimelineInfo } from '../../timeline/types';
import type { DiffFrom, TickDiff } from '../diff/types';
import type { DiagramIcons } from '../icons';

export interface LensInfo {
  readonly id: LensId;
  readonly title: string;
  readonly description: string;
  /** The level the lens opens at (applied on a lens switch unless the person chose another level). */
  readonly defaultDetail: DetailLevel;
}

/** The canvas size in CSS px; the worker turns it into the `auto` detail level's rect budget. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/**
 * The day of a snapshot a follow-up request reads: the tick its diagram on screen drew (`source.tick`), or
 * `null` for the snapshot's own day. Every request that follows a Scene names it, so its answer is that day's
 * whatever the worker drew last (a request made while the next day is being prepared still reads the day on screen).
 */
export type DayRef = DiffFrom;

export type DataRequest =
  | { readonly type: 'lenses'; readonly id: number }
  | {
      readonly type: 'scene';
      readonly id: number;
      readonly spec: ViewSpec;
      readonly viewport: Viewport;
      /** The day to compare the drawn day with (diff/base.ts); absent, no diff. */
      readonly diffFrom?: DiffFrom;
    }
  /** What the view controls offer for a snapshot on a day (views/choices.ts). */
  | { readonly type: 'choices'; readonly id: number; readonly snapshot: SnapshotRef; readonly day: DayRef }
  /** The details drawer's facts about one node of a snapshot on a day (drawer/details.ts). */
  | {
      readonly type: 'details';
      readonly id: number;
      readonly snapshot: SnapshotRef;
      readonly node: string;
      readonly day: DayRef;
    }
  /** What changed about one node from day `since` to day `day` of a snapshot (drawer/changes.ts). */
  | {
      readonly type: 'changes';
      readonly id: number;
      readonly snapshot: SnapshotRef;
      readonly node: string;
      /** The day compared with (the diagram's `diff.since`). */
      readonly since: DiffFrom;
      /** The day drawn (the diagram's `source.tick`; null: the snapshot's own day). */
      readonly day: DiffFrom;
    }
  /** The nodes of a snapshot on a day that match a text (search/service.ts; empty text builds the index). */
  | { readonly type: 'search'; readonly id: number; readonly query: SearchQuery }
  /**
   * Where a node is in a view on a day and what would show it (search/locate.ts): a search hit's, with the offers,
   * or a jump link's of the details drawer, without them (only the zones around it opened).
   */
  | { readonly type: 'locate'; readonly id: number; readonly query: LocateQuery }
  /** A demo organisation with its history, ready to store as `demo:<size>` (demo.ts, in demoRole.ts's worker). */
  | { readonly type: 'demo'; readonly id: number; readonly size: DemoSize };

export type DataStage = 'generate' | 'ingest' | 'graph' | 'scene';

export interface SceneSource {
  readonly ref: SnapshotRef;
  /** The scope's display name ("example.com"). */
  readonly scope: string;
  /** The read time of the data drawn: the snapshot's, or the timeline day's. */
  readonly readTime: string;
  readonly assets: number;
  /** The timeline day drawn (`YYYY-MM-DD`); absent: the snapshot itself. */
  readonly tick?: string;
  /** The snapshot's timeline (timeline/types.ts); absent when the worker could not work it out. */
  readonly timeline?: TimelineInfo;
}

export interface SceneAnswer {
  readonly scene: Scene;
  readonly report: SceneReport;
  readonly source: SceneSource;
  readonly lensTitle: string;
  /** The icons the Scene's drawing needs (the icon table stays in the worker). */
  readonly icons: DiagramIcons;
  /** Product-container zones' type names by id, for their accessible names. */
  readonly zoneTypes: Readonly<Record<string, string>>;
  /**
   * The console action of each asset-backed Scene node by id: its page through the catalog's console
   * template, or its project's console home; worked out here, where the assets and the catalog are.
   */
  readonly consoleLinks: Readonly<Record<string, ConsoleLink>>;
  /**
   * The drawn day compared with the day asked for (diff/tickDiff.ts), when the request asked and the days
   * differ; the Scene then holds the ghosts it lists.
   */
  readonly diff?: TickDiff;
}

export type DataErrorCode = 'no-snapshot' | 'unknown-snapshot' | 'protocol' | 'internal';

export interface DataErrorInfo {
  readonly code: DataErrorCode;
  readonly message: string;
}

export type DataResponse =
  | { readonly type: 'lenses'; readonly id: number; readonly lenses: readonly LensInfo[] }
  | { readonly type: 'progress'; readonly id: number; readonly stage: DataStage }
  | { readonly type: 'scene'; readonly id: number; readonly answer: SceneAnswer }
  | { readonly type: 'choices'; readonly id: number; readonly choices: ViewChoices }
  | { readonly type: 'details'; readonly id: number; readonly details: NodeDetails | null }
  | { readonly type: 'changes'; readonly id: number; readonly changes: NodeChanges | null }
  | { readonly type: 'search'; readonly id: number; readonly answer: SearchAnswer }
  | { readonly type: 'locate'; readonly id: number; readonly answer: LocateAnswer }
  /** How far a `demo` request is (the snapshot library shows it as it shows an import's). */
  | { readonly type: 'job-progress'; readonly id: number; readonly progress: JobProgress }
  | { readonly type: 'demo'; readonly id: number; readonly prepared: PreparedSnapshot }
  | { readonly type: 'error'; readonly id: number; readonly error: DataErrorInfo };
