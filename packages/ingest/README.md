<!-- SPDX-License-Identifier: MIT -->

# @gcportrait/ingest

Turns Cloud Asset Inventory data into a model `Snapshot` (the data flow in
[docs/packages.md](../../docs/packages.md); the CAI facts in the cai-ingestion skill): a streaming
NDJSON line reader, a normaliser from the CAI asset shape to the model `Asset`, project number ↔ id resolution,
snapshot assembly with stats, and a worker protocol. It reads both CAI export files (`exportAssets`, one asset
per line, snake_case envelope keys) and `assets.list` results (camelCase), as plain lines or inside the
backend's `/api/assets/stream` frames, from files, `fetch` bodies, streams and strings.

The package is a pure core. It compiles without DOM or Node types, depends only on `@gcportrait/model`, has no
side effects, never reads the clock or a random source itself, and runs the same in a Web Worker, in Node and
in tests. The single exception is the worker handler's *defaults* for the snapshot id (`Date.now`,
`crypto.getRandomValues`), which a caller can replace. `src/index.ts` is the only public surface.

```ts
import { ingest } from '@gcportrait/ingest';

const { snapshot, report } = await ingest([fileA, fileB], {
  scope: { kind: 'organization', id: '30000000001' },
  source: { kind: 'export', detail: 'export-a.json, export-b.json' },
  clock: () => Date.now(), // only the caller decides what "now" is
  entropy: Math.random, // the snapshot id's random part
});
if (snapshot.readTimeSource === 'estimated-max-update-time') showEstimatedReadTimeNotice(snapshot.readTime);
```

In a worker (the app's way, so that the UI thread only renders):

```ts
// ingest.worker.ts
import { createIngestWorkerHandler } from '@gcportrait/ingest';
const handle = createIngestWorkerHandler((message) => self.postMessage(message));
self.onmessage = (event) => handle(event.data);

// page
import { postIngestJob, type IngestWorkerResponse } from '@gcportrait/ingest';
worker.onmessage = ({ data }: MessageEvent<IngestWorkerResponse>) => { /* progress, done or error */ };
await postIngestJob((message, transfer) => worker.postMessage(message, transfer), 'job-1', files, settings);
```

## API

| Export | What |
|---|---|
| `ingest(input, options): Promise<IngestResult>` | Reads every source of `input` in order, as separate parts, and returns `{ snapshot, report }`. Rejects with an `IngestError` for invalid options or sources, an upstream `error` frame, or (with `strict`) the first malformed line. |
| `createIngestSession(options): IngestSession` | The synchronous core that `ingest` and the worker drive: `push(chunk)`, `endPart()`, `finish()`. After `finish()` or any throw, every call throws (`closed`, or the original error). |
| `readLines(input, options?)` | The line reader on its own: an async generator of `{ part, line, text }` for every non-blank line. Bad lines go to `onProblem`, or reject. |
| `normaliseAsset(raw): NormaliseResult` | One raw CAI asset → `{ ok: true, asset }` or `{ ok: false, message }`. |
| `projectNumberOf(asset)` | The asset's project number: its first `projects/<number>` ancestor. |
| `ulid(time, entropy)` | A canonical ULID from a time in milliseconds and an entropy source, as the snapshot's `id` is made. The app uses it to give an imported copy a new id. |
| `lookupProjectId(index, number)`, `lookupProjectNumber(index, id)` | The two lookups on a model `ProjectIndex`; both accept the bare value or `projects/…`. |
| `createIngestWorkerHandler(postMessage, environment?)` | The worker side of the protocol (below). `environment` overrides `clock` and `entropy`. |
| `postIngestJob(post, job, input, settings)` | The page side: posts `start`, the chunks of every source with their part index, and `end` (or `cancel` when a source fails). |
| `IngestError` | `code` (`invalid-options`, `invalid-source`, `malformed`, `upstream`, `unsupported-platform`, `closed`, `protocol`, `cancelled`), `problem` (for `malformed`), `upstream` (`status`, `code`, for `upstream`). |
| `DEFAULT_MAX_LINE_BYTES` | 64 MiB. |
| `DEFAULT_PROGRESS_EVERY_BYTES` | 4 MiB. |
| `MAX_REPORTED_PROBLEMS` | 20. |

Types: `IngestOptions` (= `IngestSettings` + `clock`, `entropy`, `onEvent`), `IngestSettings` (the
serialisable part a worker `start` message carries), `IngestResult`, `IngestReport`, `IngestEvent`,
`ReadTimeSource`, `ReadTimeOrigin`, `UpstreamSummary`, `UnresolvedProjects`, `IngestProblem`, `IngestProblemCode`,
`IngestInput`, `IngestSource`, `IngestChunk`, `TextLine`, the worker message unions `IngestWorkerRequest` and
`IngestWorkerResponse`, and the structural stream types `ByteStream`, `ByteStreamReader`, `BlobLike`. The
project index is the model's `ProjectIndex` (import it from `@gcportrait/model`); ingest declares no copy.

### Options

| Option | Default | Meaning |
|---|---|---|
| `scope` | required | `{ kind, id, displayName? }`, validated with the model's `SnapshotScopeSchema`. |
| `source` | required | `{ kind: 'api' \| 'export' \| 'demo', detail? }`. `detail` is free text, never a token. |
| `readTime` | see below | The CAI read time when the caller knows it (export operation metadata, timeline tick). |
| `readTimeOrigin` | from `source.kind` | Where `readTime` came from, recorded as `snapshot.readTimeSource`: `api`, `export-sidecar` or `user`. Only with `readTime`; default `api` for an `api` source, `export-sidecar` for `export`, `user` otherwise. |
| `clock` | required | Milliseconds since the epoch; called once, in `finish()`. |
| `entropy` | required | Numbers in [0, 1), like `Math.random`; 16 calls per snapshot id. |
| `strict` | `false` | Throw `malformed` at the first bad line instead of counting it. |
| `maxLineBytes` | 64 MiB | The longest line read, in bytes (text input: UTF-16 code units). Longer lines are skipped without being buffered. |
| `progressEveryBytes` | 4 MiB | Spacing of `read` events. |
| `onEvent` | none | Receives `read`, `upstream-progress` and `upstream-done` events. |

## Inputs

An `IngestInput` is one source or an array (any synchronous iterable) of sources. Each source is one *part*
(one file): line numbers restart at 1 and its last line counts even without a final newline.

| Source | Example |
|---|---|
| `string` | a whole document |
| `Uint8Array` (also a Node `Buffer`) | file bytes |
| `BlobLike` (anything with `stream()`) | a dropped `File`, a `Blob`, a Node `Blob` |
| `ByteStream` (anything with `getReader()`) | `response.body`, `blob.stream()` |
| `AsyncIterable<Uint8Array \| string>` | a Node `Readable` (`fs.createReadStream`), an async generator |

Chunk boundaries may fall anywhere: inside a line, between CR and LF, inside a multi-byte UTF-8 sequence, or
(for text) inside a surrogate pair. Bytes are split on LF before decoding, and UTF-8 never uses that byte
inside a sequence, so every line is decoded whole and strictly (invalid UTF-8 is a problem, not U+FFFD).
Per line, a trailing CR is dropped (CRLF files) and a leading byte-order mark is dropped (at the start of
every file, and inside files glued together with `cat`). Empty and whitespace-only lines are counted and
skipped. A stream abandoned early (error frame, strict mode) is cancelled and its lock released.

## Dialects

Detected per line, so they can be mixed in one input. An object is a frame when it has a `t` field and no
`name`; an object with a `name` is always an asset, so an asset that happens to carry a `t` field is never
dropped (no asset is ever dropped: AGENTS.md, Product rules).

| Line | Dialect | Handling |
|---|---|---|
| an object with a `name`, or without a `t` field | CAI NDJSON (an export line or an `assets.list` asset) | normalised into one `Asset` |
| `{"t":"page","assets":[…]}` | backend frame | each item normalised; a bad item is a problem with its `item` index |
| `{"t":"progress","pages":n,"assets":m}` | backend frame | `upstream-progress` event |
| `{"t":"done","assets":m,"readTime":"…"}` | backend frame | `upstream-done` event; `readTime` (optional) becomes the snapshot's read time; `report.upstream.complete` |
| `{"t":"error","message":"…","status":403,"code":"PERMISSION_DENIED"}` | backend frame | the ingest rejects with `IngestError('upstream')`, the message verbatim, `status` and `code` when present |
| any other `t` | | `unknown-frame` problem |

A frame stream without a `done` frame was cut short: `report.upstream.complete` is `false`.

### Key styles

The asset envelope is spelled two ways, and both are read, as plain lines and inside `page` frames:

| Source | Envelope keys |
|---|---|
| `assets.list` (API JSON, the backend's frames, demo-data's default output) | `assetType`, `updateTime`, `resource.discoveryDocumentUri`, `resource.discoveryName` |
| files written by `exportAssets` to Cloud Storage (protobuf field names) | `asset_type`, `update_time`, `resource.discovery_document_uri`, `resource.discovery_name` |

`name`, `ancestors`, `resource.parent`, `resource.data` and `resource.location` are spelled the same in both,
and `data` is the resource's own API JSON (camelCase) either way. An asset may mix the styles field by field;
an asset that carries both spellings of a field with different values is an `invalid-asset` problem. Messages
name a field the way the line spells it (`update_time: Invalid input…` for an export line).

## Normalisation (to the model's `AssetSchema`)

| Model `Asset` field | From | Rule |
|---|---|---|
| `name` | `name` | verbatim |
| `assetType` | `assetType` or `asset_type` | verbatim |
| `parent` | `resource.parent` | left out when missing, `null` or `''` |
| `ancestors` | `ancestors` | as given, closest first; `[]` when missing |
| `location` | `resource.location` | left out when missing, `null` or `''` |
| `updateTime` | `updateTime` or `update_time` | verbatim |
| `data` | `resource.data` | passed on by reference, untouched; `null` when CAI sent none |

The model's `AssetSchema` decides validity; an asset that fails it (no name, a relative name, a malformed
asset type or timestamp, an unknown ancestor kind) is an `invalid-asset` problem, never repaired. Everything
else in the envelope (`resource.version`, the discovery fields) is dropped.

## Project numbers and ids

CAI puts project *numbers* in `ancestors` and `resource.parent`, while Compute names, self-links and many other
names use project *ids*. `report.projects` pairs them. It is exactly the model's `ProjectIndex`
(`{ numberById, idByNumber }`, `ProjectIndexSchema` in `@gcportrait/model`) and is built by the model's one
pairing rule (`projectIndexBuilder`, the code behind `buildProjectIndex` in `@gcportrait/model`), so
`report.projects` equals `buildProjectIndex(snapshot.assets)`. That function builds the index of a snapshot
loaded from storage; ingest exports no second builder.

- Only **Project assets** (`cloudresourcemanager.googleapis.com/Project`) pair a number with an id, in
  snapshot order: the number from the asset name (`…/projects/<number>`), else `data.projectNumber` (a decimal
  string); the id from `data.projectId`.
- A number or id that is already paired keeps its first pairing, so the two records stay exact inverses.
- The index is built once, in `finish()`, over the kept assets: a duplicate that lost to a newer copy
  contributes nothing. Records are sorted (numbers numerically, ids alphabetically).

Everything the rule leaves unpaired is reported next to it in `report.unresolvedProjects`
(`UnresolvedProjects`, sorted plain data):

| Field | Meaning |
|---|---|
| `numbers` | project numbers seen in ancestors, `resource.parent`, Project assets, Compute names or Compute self-links that the index cannot name: typically an export filtered by asset type, without Project assets |
| `ids` | ids of projects that assets in the snapshot live in (the id in a Compute asset name, or a Project asset's id that lost a conflicting claim) without a number |
| `referencedIds` | ids that only Compute self-links inside `data` refer to (`https://www.googleapis.com/compute/{v1,beta,alpha}/projects/<id>/…`): a Shared VPC host outside the scope, public image projects (`debian-cloud`), service producers' tenant projects (`…-tp`) |
| `inferred` | number → id hints: a Compute asset named `…/projects/<id>/…` whose closest ancestor is `projects/<number>`, for numbers and ids the index lacks; one-to-one, first one wins; for display, never used for resolution |

`projectNumberOf(asset)` gives each asset's number (its first `projects/<number>` ancestor);
`lookupProjectId` and `lookupProjectNumber` resolve through the index.

## Snapshot assembly

- `id`: a ULID from `clock()` and `entropy`, so it is deterministic in tests.
- `readTime`: the `readTime` option; else the latest `readTime` of the `done` frames; else the latest asset
  `updateTime` (an estimate: the UI must say so; skill cai-ingestion §1, "Export facts"); else the clock (an
  empty input). `report.readTimeSource` is `option`, `upstream`, `max-update-time` or `clock`, and the
  snapshot carries the model's `readTimeSource` with it: the `readTimeOrigin` for `option`, `api` for
  `upstream`, `estimated-max-update-time` for `max-update-time` (the "estimated" marker survives storage), and
  nothing for the clock fallback of an input without assets.
- `stats`: `count`, `byType` (sorted by type) and `bytes`, the raw input size (BOMs, CRs and blank lines
  included; text counted as UTF-8).
- Duplicate names (the same file dropped twice, overlapping exports): one asset per name is kept, the one with
  the latest `updateTime` (to the nanosecond; the first on a tie), at the position where the name first
  appeared. `report.duplicates` counts the others. Discarded copies never feed the project index; they
  cannot change the latest `updateTime` either, because the copy a name keeps has its latest one.

## Malformed input and the report

Bad lines never stop a normal ingest. Each one is counted in `report.malformed`, and the first 20 are kept in
`report.problems` as `{ code, part, line, item?, message }` with 1-based line numbers that count blank lines
(they match an editor). Codes: `invalid-utf8`, `line-too-long`, `invalid-json`, `not-an-object`,
`unknown-frame`, `invalid-frame`, `invalid-asset`. With `strict: true` the first one throws
`IngestError('malformed')` with the problem attached.

The report also has `parts`, `lines`, `blankLines`, `assetLines`, `frameLines`, `duplicates`,
`readTimeSource`, `upstream` (`pages`, `complete`, `reportedAssets?`, `readTime?`; only when frames were seen),
`projects` and `unresolvedProjects`. The whole `IngestResult` is plain data: it survives `postMessage`, `structuredClone` and JSON.

## Worker protocol

| Direction | Message | Meaning |
|---|---|---|
| page → worker | `{ type: 'start', job, settings }` | starts a job; `settings` is `IngestSettings` (no functions) |
| page → worker | `{ type: 'chunk', job, part?, data }` | the next `Uint8Array` or string; `part` is the file index (default: current), never decreasing; a higher index ends the parts before it |
| page → worker | `{ type: 'end', job, parts? }` | no more input; `parts` is the number of parts (files), so trailing empty files, which send no chunk, still count (default: up to the last part that sent a chunk) |
| page → worker | `{ type: 'cancel', job }` | abandon the job; the worker drops it and answers `error` with code `cancelled` |
| worker → page | `{ type: 'progress', job, event }` | an `IngestEvent` |
| worker → page | `{ type: 'done', job, result }` | the `IngestResult` |
| worker → page | `{ type: 'error', job, error }` | `{ code, message, problem?, upstream? }`; `code` is an `IngestErrorCode`, or `internal` for an unexpected exception |

One handler runs any number of jobs at once, and answers every job it started with exactly one `done` or
`error`. After that the job is gone; chunks, `end` or `cancel` still in flight for it are dropped silently.
Malformed messages, unknown jobs, a repeated `start`, decreasing parts and an `end` announcing fewer parts
than arrived are `protocol` errors. `postIngestJob` transfers (moves) chunks it read from Blobs and streams
when they own their whole buffer, and copies caller-owned strings, arrays and iterables; it sends `end` with
the part count, so the worker's report equals `ingest()`'s for the same input (empty files included). When a
source fails to read, it posts `cancel` and rejects with the source's error.

## Limits

| Limit | Value |
|---|---|
| Longest line | `maxLineBytes`, default 64 MiB: above the backend's 25 MiB page cap and any single asset. Tested with 10 MiB lines, a 12 MiB page frame, and an 11 MiB line skipped at a 10 MiB limit. |
| Problems kept | 20 (all are counted) |
| Memory | the snapshot itself plus at most one line in flight; a skipped over-long line is never buffered |

## Performance

`test/worker-budget.test.ts` measures the ingest budget: 50 000 assets parsed in a worker in under 1.5 s. The
input is generated in the test (`test/synthetic-org.ts`) as an `exportAssets` file (snake_case envelope
keys): one organisation, folders, 50 projects and a realistic mix of Compute instances and disks, GKE pods and
services, firewalls, service accounts, buckets, BigQuery tables with schemas, Pub/Sub topics, Cloud Run
services and KMS keys; 76.3 MiB, 1 599 bytes per line on average. The file is posted as a `Blob` through
`postIngestJob` to a `worker_threads` worker running the package's handler; the clock runs from the first
message to the `done` reply arriving on the main thread, so it includes reading, transfer, parsing,
normalisation, the project index and the structured clone of the result back. The worker runs a warm-up
job first; a run over the limit is measured again after a 250 ms pause, at most five runs and only while
another fits in 95 % of the test's timeout, and the best run counts (`measureBatches` of
`@gcportrait/model/testing`, the rule every package that times its work applies). On a desktop machine with
little else running a run takes about 1 s; with the machine's cores busy several times over it takes 1.3 to
2 s, which is why the strict check runs alone (below).

In-process the input takes about 500 ms to ingest (JSON.parse about 240 ms, the project index about 80 ms,
normalisation through `AssetSchema` about 45 ms); posting the 50 000-asset result back to the page (structured
clone) takes about 460 ms of the total. Reading the snake_case export style costs nothing extra: the
normaliser takes about 42 ms (export keys) and 44 ms (`assets.list` keys) per 50 000 assets.

A wall-clock budget only means something on a machine that is not busy with other work, so the strict
assertion runs only with `GCPORTRAIT_INGEST_BUDGET=strict`: `pnpm --filter @gcportrait/ingest test:budget`
runs this one file that way and prints the figures. Inside the normal, parallel test run (`pnpm test`, the CI
unit job) the same measurement asserts a regression ceiling of 3 × 1.5 s instead, which still catches an
order-of-magnitude slowdown on a busy machine. Under a local `pnpm test` a best run still over the ceiling
while the machine's one-minute load average is above 1.5 per core is skipped, with the load and the figures
as the reason and a `skipped:` line on standard error (`skipIfOverloaded`): four times oversubscribed, the
figure measures the machine. On CI (`CI` set) the ceiling is the check that blocks, so it never skips, and
neither does `test:budget`. Add `--silent=false` to print the figures there (Vitest ignores flags after a
`--`).

## Tests

```sh
pnpm --filter @gcportrait/ingest test                 # unit, property, fixture tests; budget as a regression ceiling
pnpm --filter @gcportrait/ingest test --coverage      # plus V8 coverage with thresholds
pnpm --filter @gcportrait/ingest test --silent=false  # also print the budget figures
pnpm --filter @gcportrait/ingest test:budget          # the strict 1.5 s budget, this file alone, figures printed
pnpm --filter @gcportrait/ingest typecheck            # src/ without DOM or Node types; test/ with Node types
```

- `src/*.test.ts`: unit tests next to the code, table-driven where it helps; `src/ingest.property.test.ts`
  (fast-check) proves that any cut of a document into byte chunks or text chunks yields the same snapshot and
  report, and exactly the generated assets (each generated asset in either key style).
- `test/fixtures.test.ts`: the recorded-shape samples in `fixtures/`: an organisation export in the
  `exportAssets` key style (`cai-export`) and the same organisation as `assets.list` results (`cai-list`),
  which must give the same snapshot; backend frame streams (complete, with an error frame, cut short); a
  two-file `uriPrefix` export; Shared VPC with missing Project assets; duplicates; malformed lines in both key
  styles. Each is also read with a BOM, CRLF, blank lines and 1- and 4096-byte chunks; real Node and web
  sources (`Blob`, `blob.stream()`, a `fetch` Response body, `fs.createReadStream`, a text `Readable`); huge
  lines.
- `test/synthetic-data.test.ts`: fixtures, generated data and test sources contain no real organisation data,
  checked with the one guard of `@gcportrait/model/testing` (`findNonSyntheticData`: example domains,
  the demo organisations 30000000001 to 30000000004, numbers below 100000000000, `demo-…` project ids, private
  or documentation IPs).
- `test/worker-budget.test.ts`: the budget above.

All fixtures are synthetic. The `test/` folder has its own tsconfig with Node types so they never leak into
`src/`.
