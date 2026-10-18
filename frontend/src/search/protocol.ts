// SPDX-License-Identifier: Apache-2.0
/**
 * What the search asks the data worker and what it answers (the worker's `search` and `locate` requests,
 * diagram/pipeline/protocol.ts); the details drawer's jump links ask `locate` too, without offers. Plain data
 * only: everything here crosses `postMessage`. The index and the locator run in the data worker, where the Graph
 * is (service.ts); the page only shows the answers.
 */
import type { Icon } from '@gcportrait/icons';
import type { SnapshotRef, ViewSpec } from '@gcportrait/model';

import type { DiffFrom } from '../diagram/diff/types';
import type { RevealFacts, RevealStep } from './reveal';

/** What a result is, for grouping the list: resource hierarchy, networks, other containers, resources. */
export type SearchKind = 'folder' | 'project' | 'network' | 'container' | 'resource';

/** The field a result matched on, for the hint next to it ("IP 10.0.14.5"). */
export type MatchField =
  'label' | 'displayName' | 'name' | 'id' | 'ip' | 'domain' | 'project' | 'type' | 'ancestor';

/** How a result matched: the query equals a field, starts one, is an address inside a range, or is close. */
export type MatchTier = 'exact' | 'prefix' | 'range' | 'fuzzy';

export interface SearchQuery {
  /** The snapshot whose Graph to search (the view's). */
  readonly snapshot: SnapshotRef;
  /** The day whose Graph to search: the tick drawn on screen, or null for the snapshot's own day. */
  readonly day: DiffFrom;
  /** The text as typed; empty text only prepares the index. */
  readonly text: string;
  /** How many results to send at most. */
  readonly limit: number;
}

export interface SearchHit {
  /** The Graph node id (the asset's full resource name). */
  readonly id: string;
  readonly label: string;
  readonly kind: SearchKind;
  /** "Compute Engine instance". */
  readonly typeName: string;
  /** The project id it belongs to; absent for folders and assets outside any project. */
  readonly project?: string;
  /** The icon key (in `SearchAnswer.icons`). */
  readonly icon: string;
  /** Hidden by default (its type's role, or the type's hidden-by-default rule matched it). */
  readonly hidden: boolean;
  readonly tier: MatchTier;
  /** What matched, when it is not the label itself. */
  readonly match?: { readonly field: MatchField; readonly value: string };
}

export interface SearchAnswer {
  /** The text this answers, trimmed. */
  readonly text: string;
  /** How many nodes matched (the hits are the best `limit` of them). */
  readonly total: number;
  readonly hits: readonly SearchHit[];
  /** The icons the hits name, resolved in the worker (the icon table never loads on the UI thread). */
  readonly icons: Readonly<Record<string, Icon>>;
}

export interface LocateQuery {
  /** The view as it is in the hash (selection and highlight are ignored). */
  readonly spec: ViewSpec;
  /** The day drawn on screen (the view's `tick` may name a live day not read yet): null for the snapshot's own. */
  readonly day: DiffFrom;
  /** The canvas size the view is drawn at (the `auto` detail level depends on it). */
  readonly viewport: { readonly width: number; readonly height: number };
  /** The node to reveal. */
  readonly node: string;
  /**
   * Whether a node the view does not reach gets its offers, each tried by building its view: true for a chosen
   * search result (the reveal dialog), false for a jump link of the details drawer, which only opens the zones
   * around its target. A locate with offers supersedes the one with offers before it, in the page and in the
   * worker; one without is never superseded, so a jump link and a search never cancel each other.
   */
  readonly offers: boolean;
}

/** A view change that shows the node, checked in the worker by building its Scene. */
export interface RevealOffer {
  /** What it changes, in order (drill-in, lens, include the type, clear filters). */
  readonly steps: readonly RevealStep[];
  /** The view to switch to: the steps applied, plus the flips that open the chips around the node. */
  readonly view: ViewSpec;
}

/** The names a reveal's messages use, worked out where the Graph and the catalog are. */
export interface RevealContext {
  readonly label: string;
  readonly typeName: string;
  /** The container the view is drilled into, when it has a root. */
  readonly root?: string;
  /** The lens's title ("Overview"), and the title of the Everything lens. */
  readonly lensTitle: string;
  readonly everythingTitle: string;
  /** The container a drill-in offer re-roots at (absent: the whole organisation). */
  readonly drillTarget?: string;
}

export type LocateAnswer =
  /** The snapshot has no such node. */
  | { readonly kind: 'missing' }
  /** Drawn as itself: select it and glide there. */
  | { readonly kind: 'shown'; readonly context: RevealContext }
  /** Inside collapsed zones: switch to `view` (their flips added), then select and glide. */
  | {
      readonly kind: 'expand';
      readonly context: RevealContext;
      readonly view: ViewSpec;
      /** The labels of the zones opened, outermost first. */
      readonly opened: readonly string[];
    }
  /** Not in this view: the person picks one of the offers (each shows it), or keeps the view. */
  | {
      readonly kind: 'offer';
      readonly context: RevealContext;
      readonly facts: RevealFacts;
      readonly offers: readonly RevealOffer[];
    }
  /** Not in this view, and no offer would show it (or none was asked for: `offers` false). */
  | { readonly kind: 'unavailable'; readonly context: RevealContext; readonly facts: RevealFacts };
