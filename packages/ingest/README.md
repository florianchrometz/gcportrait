<!-- SPDX-License-Identifier: MIT -->

# @gcportrait/ingest

Turns Cloud Asset Inventory data into a model `Snapshot` (the data flow in
[docs/packages.md](../../docs/packages.md); the CAI facts in the cai-ingestion skill): a streaming
NDJSON line reader, a normaliser from the CAI asset shape to the model `Asset`, project number ↔ id
resolution, and snapshot assembly with stats. It reads both CAI export files (`exportAssets`, one asset per
line, snake_case envelope keys) and `assets.list` results (camelCase), as plain lines or inside the backend's
`/api/assets/stream` frames, from files, `fetch` bodies, streams and strings.

The package is a pure core. It compiles without DOM or Node types, depends only on `@gcportrait/model`, has no
side effects, never reads the clock or a random source itself (the caller passes both), and runs the same in a
Web Worker, in Node and in tests. The one platform API it uses is `TextDecoder`, to decode UTF-8.
`src/index.ts` is the only public surface.

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

The app runs it in its workers, so that the UI thread only renders, each with its own protocol: the snapshot
worker reads a dropped export with `ingest` (`frontend/src/snapshots/worker/handler.ts`), the data worker the
demo organisations and the timeline's days, and the import worker feeds the chunks of a live pull or an
export read to a session as the page receives them (`frontend/src/import/worker/handler.ts`):

```ts
const session = createIngestSession({ scope, source, clock: () => Date.now(), entropy: Math.random });
for await (const chunk of response.body) session.push(chunk); // bytes or text, cut anywhere
const { snapshot, report } = session.finish();
```

## API

| Export | What |
|---|---|
| `ingest(input, options): Promise<IngestResult>` | Reads every source of `input` in order, as separate parts, and returns `{ snapshot, report }`. Rejects with an `IngestError` for invalid options or sources, an upstream `error` frame, or (with `strict`) the first malformed line. |
| `createIngestSession(options): IngestSession` | The synchronous core that `ingest` drives, for a caller that receives its input chunk by chunk: `push(chunk)`, `endPart()`, `finish()`. After `finish()` or any throw, every call throws (`closed`, or the original error). |
| `readLines(input, options?)` | The line reader on its own: an async generator of `{ part, line, text }` for every non-blank line. Bad lines go to `onProblem`, or reject. |
| `normaliseAsset(raw): NormaliseResult` | One raw CAI asset → `{ ok: true, asset }` or `{ ok: false, message }`. |
| `projectNumberOf(asset)` | The asset's project number: its first `projects/<number>` ancestor. |
| `ulid(time, entropy)` | A canonical ULID from a time in milliseconds and an entropy source, as the snapshot's `id` is made. The app uses it to give an imported copy a new id. |
| `IngestError` | `code` (`invalid-options`, `invalid-source`, `malformed`, `upstream`, `unsupported-platform`, `closed`), `problem` (for `malformed`), `upstream` (`status`, `code`, for `upstream`). |
| `DEFAULT_MAX_LINE_BYTES` | 64 MiB. |
| `DEFAULT_PROGRESS_EVERY_BYTES` | 4 MiB. |
| `MAX_REPORTED_PROBLEMS` | 20. |

Types: `IngestOptions` (= `IngestSettings` + `clock`, `entropy`, `onEvent`), `IngestSettings` (the
serialisable part, which a worker message can carry), `IngestResult`, `IngestReport`, `IngestEvent`,
`ReadTimeSource`, `ReadTimeOrigin`, `UpstreamSummary`, `UnresolvedProjects`, `IngestProblem`,
`IngestProblemCode`, `IngestErrorCode`, `IngestInput`, `IngestSource`, `IngestChunk`, `TextLine`, and the
structural stream types `ByteStream`, `ByteStreamReader`, `BlobLike`. The project index is the model's
`ProjectIndex` (import it from `@gcportrait/model`, and read it through its two records); ingest declares no
copy.

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

CAI puts project *numbers* in `ancestors` and `resource.parent`, while Compute names, self-links and many
other names use project *ids*. `report.projects` pairs them. It is exactly the model's `ProjectIndex`
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

`projectNumberOf(asset)` gives each asset's number (its first `projects/<number>` ancestor).

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
`readTimeSource`, `upstream` (`pages`, `complete`, `reportedAssets?`, `readTime?`; only when frames were
seen), `projects` and `unresolvedProjects`. The whole `IngestResult` is plain data: it survives `postMessage`,
`structuredClone` and JSON.

## Limits

| Limit | Value |
|---|---|
| Longest line | `maxLineBytes`, default 64 MiB: above the backend's 25 MiB page cap and any single asset. Tested with 10 MiB lines, a 12 MiB page frame, and an 11 MiB line skipped at a 10 MiB limit. |
| Problems kept | 20 (all are counted) |
| Memory | the snapshot itself plus at most one line in flight; a skipped over-long line is never buffered |

## Performance

`test/worker-budget.test.ts` measures the ingest budget (packages/AGENTS.md, "Performance budgets": XL ingest
1.5 s) on the input it names: the demo organisation XL of `@gcportrait/demo-data` (the default seed, the
demo's day), written as an `exportAssets` file (`toCaiNdjson(assets, 'export')`, snake_case envelope keys):
51 242 assets in 370 projects, 77.6 MiB, 1 588 bytes per line on average. The file is posted as a `Blob` to a
`worker_threads` worker (`test/ingest-worker.ts`) that reads it with `ingest()`, as the app's snapshot worker
reads a dropped export; the clock runs from posting the Blob to the result arriving on the main thread, so it
includes reading, parsing, normalisation, the project index and the structured clone of the result back. The
worker runs a warm-up job first (the file's first 100 lines), with one run per batch. Measurement and
overload handling use `measureBatches`, `measureRuns` and `skipIfOverloaded` from
`@gcportrait/model/testing` ([Testing export](../model/README.md#testing-export-gcportraitmodeltesting)).
The budget describes a machine with little else running: with the machine's cores busy about twice over a run
takes 2.5 to 5 s, which is why the strict check runs alone (below).

In process, parsing the lines' JSON takes a third to a half of the ingest, and normalisation through
`AssetSchema` and the project index each under a tenth; posting the result back to the page (structured clone)
takes about four fifths as long as the ingest itself. Reading the snake_case export style costs nothing extra:
the normaliser takes the same time for export keys and `assets.list` keys.

A wall-clock budget only means something on a machine that is not busy with other work, so the strict
assertion runs only with `GCPORTRAIT_INGEST_BUDGET=strict`: `pnpm --filter @gcportrait/ingest test:budget`
runs this one file that way and prints the figures. Inside the normal, parallel test run (`pnpm test`, the CI
unit job) the same measurement asserts a regression ceiling of 2 × 1.5 s instead, as every budget does there
(packages/AGENTS.md, "Performance budgets"). Add `--silent=false` to print the figures there (Vitest ignores
flags after a `--`).

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
  report, and exactly the generated assets (each generated asset in either key style). These properties and
  the line reader's (`src/lines.test.ts`) run under the seed rule of `@gcportrait/model/testing`
  (`test/fast-check-seed.ts`): a fresh seed on every local run, the fixed `CI_PROPERTY_SEED` on CI, and
  `FC_SEED=<n>` replays the seed fast-check prints with a failure.
- `test/fixtures.test.ts`: the recorded-shape samples in `fixtures/`: an organisation export in the
  `exportAssets` key style (`cai-export`) and the same organisation as `assets.list` results (`cai-list`),
  which must give the same snapshot; backend frame streams (complete, with an error frame, cut short); a
  two-file `uriPrefix` export; Shared VPC with missing Project assets; duplicates; malformed lines in both key
  styles. Each is also read with a BOM, CRLF, blank lines and 1- and 4096-byte chunks; real Node and web
  sources (`Blob`, `blob.stream()`, a `fetch` Response body, `fs.createReadStream`, a text `Readable`); huge
  lines.
- `test/synthetic-data.test.ts`: fixtures and test sources contain no real organisation data, checked with
  the one guard of `@gcportrait/model/testing` (`findNonSyntheticData`: example domains, the demo
  organisations 30000000001 to 30000000004, numbers below 100000000000, `demo-…` project ids, private or
  documentation IPs). The demo organisation the budget reads passes the same guard in demo-data's own tests.
- `test/worker-budget.test.ts`: the budget above, with its worker `test/ingest-worker.ts`.

All fixtures are synthetic. The `test/` folder has its own tsconfig with Node types so they never leak into
`src/`, and it is the one place that may import `@gcportrait/demo-data`, a dev dependency for the budget's
input (docs/packages.md §2; `eslint.config.js` holds the edge).
