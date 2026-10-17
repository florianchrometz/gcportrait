// SPDX-License-Identifier: MIT
/**
 * The search in the data worker (diagram/pipeline/dataHandler.ts routes the `search` and `locate` requests
 * here; the details drawer's jump links ask `locate` too). The index is built from the Graph the worker keeps for
 * the view's snapshot on the day the query names (the day on screen), once per Graph (a `WeakMap`, so a new
 * snapshot's or day's Graph gets a new index and the old one goes with its Graph); a `search` with empty text only
 * builds it, which the search box asks for when it gets focus. Answers carry the icons their results name,
 * resolved here like the Scene's, so the icon table never loads on the UI thread. Never import this module on
 * the UI thread.
 */
import { catalog as compiledCatalog } from '@gcportrait/catalog';
import { GENERIC_ICON } from '@gcportrait/graph';
import { resolveIcon, type Icon } from '@gcportrait/icons';
import {
  SnapshotRefSchema,
  ViewSpecSchema,
  type Catalog,
  type Graph,
  type SceneEnv,
  type Snapshot,
} from '@gcportrait/model';

import { parseFollowUpDay } from '../diagram/pipeline/days';
import { searchDocuments } from './documents';
import { locateNode } from './locate';
import type { LocateAnswer, LocateQuery, SearchAnswer, SearchHit, SearchQuery } from './protocol';
import { createSearchIndex, searchIndex, type RankedHit, type SearchIndex } from './rank';

/** The most results one answer carries. */
export const MAX_SEARCH_LIMIT = 100;

/** What the data worker has loaded for a snapshot. */
export interface LoadedSnapshot {
  readonly snapshot: Snapshot;
  readonly graph: Graph;
}

const indexes = new WeakMap<Graph, SearchIndex>();

/** The search index of a loaded snapshot's Graph, built on first use. */
export function searchIndexOf(loaded: LoadedSnapshot, catalog: Catalog = compiledCatalog): SearchIndex {
  const known = indexes.get(loaded.graph);
  if (known !== undefined) return known;
  const index = createSearchIndex(searchDocuments(loaded.graph, loaded.snapshot.assets, catalog));
  indexes.set(loaded.graph, index);
  return index;
}

function toHit(hit: RankedHit): SearchHit {
  const { doc } = hit;
  return {
    id: doc.id,
    label: doc.label,
    kind: doc.kind,
    typeName: doc.typeName,
    ...(doc.projectId === '' ? {} : { project: doc.projectId }),
    icon: doc.icon ?? GENERIC_ICON,
    hidden: doc.hidden,
    tier: hit.tier,
    ...(hit.field === 'label' ? {} : { match: { field: hit.field, value: hit.value } }),
  };
}

export function answerSearch(query: SearchQuery, loaded: LoadedSnapshot): SearchAnswer {
  const index = searchIndexOf(loaded);
  const text = query.text.trim();
  const limit = Math.min(MAX_SEARCH_LIMIT, Math.max(1, Math.floor(query.limit)));
  const { total, hits } = searchIndex(index, text, limit);
  const results = hits.map(toHit);
  const icons: Record<string, Icon> = {};
  for (const hit of results) icons[hit.icon] ??= resolveIcon(undefined, hit.icon);
  return { text, total, hits: results, icons };
}

export function answerLocate(query: LocateQuery, loaded: LoadedSnapshot, env: SceneEnv): LocateAnswer {
  return locateNode({ graph: loaded.graph, catalog: compiledCatalog, env }, query.spec, query.node, query);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A `search` request's query, checked; null when malformed. */
export function parseSearchQuery(value: unknown): SearchQuery | null {
  if (!isRecord(value)) return null;
  const snapshot = SnapshotRefSchema.safeParse(value['snapshot']);
  const text = value['text'];
  const limit = value['limit'];
  const day = parseFollowUpDay(value['day']);
  if (!snapshot.success || typeof text !== 'string' || typeof limit !== 'number' || !(limit > 0)) return null;
  if (day === null) return null;
  return { snapshot: snapshot.data, day, text, limit };
}

/** A `locate` request's query, checked; null when malformed. */
export function parseLocateQuery(value: unknown): LocateQuery | null {
  if (!isRecord(value)) return null;
  const spec = ViewSpecSchema.safeParse(value['spec']);
  const node = value['node'];
  const viewport = value['viewport'];
  const day = parseFollowUpDay(value['day']);
  const offers = value['offers'];
  if (!spec.success || typeof node !== 'string' || node === '' || !isRecord(viewport)) return null;
  if (day === null || typeof offers !== 'boolean') return null;
  const width = viewport['width'];
  const height = viewport['height'];
  if (typeof width !== 'number' || typeof height !== 'number' || !(width > 0) || !(height > 0)) return null;
  return { spec: spec.data, day, node, viewport: { width, height }, offers };
}
