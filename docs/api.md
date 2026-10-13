<!-- SPDX-License-Identifier: MIT -->

# API

gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
trademarks of Google and are used under Google's icon usage terms.

Every route an instance serves under `/api`, for scripts: health and settings, the scope search and permission
check, the live pull and export read the app streams from, and `POST /api/render`, which draws a view as SVG,
PNG or a draw.io file on the server, byte for byte what `pnpm render` and the app's export draw. A demo-only
instance has none of the routes that need a token.

## Authentication

The routes that read Google Cloud take your own Google access token and nothing else; the instance stores it
nowhere and logs it never. Send it in `X-Gcportrait-Token` (the app's header, which Identity-Aware Proxy
leaves alone), or in `Authorization: Bearer` when there is no `X-Gcportrait-Token` ([permissions.md, "With
your own account"](permissions.md#2-with-your-own-account)). A token from `gcloud auth print-access-token`
works; reading a scope needs the permissions of [permissions.md](permissions.md). Behind Identity-Aware Proxy,
IAP takes `Authorization` for its own sign-in, so use `X-Gcportrait-Token` there.

```sh
curl -s https://YOUR_INSTANCE/api/healthz
curl -s -H 'X-Gcportrait-Token: YOUR_ACCESS_TOKEN' --json '{"query":"demo"}' https://YOUR_INSTANCE/api/scopes/search
```

Every request is JSON (`curl --json`, curl 7.82 or later, sets both content headers), except a render's
upload. Answers carry `cache-control: no-store` and `x-request-id`; quote the id when you report a problem.

## Routes

| Route | Token | Answer |
|---|---|---|
| `GET /api/healthz` | no | `{ status: "ok", version }`. (`/healthz` is the same for the container's probes; Cloud Run answers it itself from outside.) |
| `GET /api/config` | no | The instance's public settings: OAuth client id, service-account mode and account, version, source URL, `hostedBy` (who runs it, "Hosted by NAME.", or `null`), `demoOnly`, which legal pages exist, and `render`, the render API's limits or `null` where it is off. |
| `GET /api/legal` | no | `{ impressum, privacy }`, the Markdown of each legal page or `null`. |
| `POST /api/scopes/search` | yes | `{ query, kinds?, pageSize?, pageToken? }` → the organisations, folders and projects your token can see, `{ scopes, nextPageToken?, problems }`. |
| `POST /api/preflight` | yes | `{ scope, mode: "user" \| "sa", quotaProject? }` → the permission checklist for reading `scope`, with `gcloud` commands for what is missing. |
| `POST /api/assets/stream` | yes | `{ scope, contentType: "RESOURCE", mode, quotaProject?, readTime?, assetTypes? }` → the live pull as NDJSON frames (`page`, `progress`, then `done` or `error`). |
| `POST /api/export/read` | yes | `{ gcsUri }` → the lines of a Cloud Asset Inventory export in Cloud Storage (one object, or every object under a prefix ending in `/`), as NDJSON. |
| `POST /api/render` | yes | A view drawn as SVG, PNG or a draw.io file ([below](#post-apirender)). Absent with `RENDER_API=false`. |

A scope is `organizations/YOUR_ORG_ID`, `folders/YOUR_FOLDER_ID` or `projects/YOUR_PROJECT_ID`. In `user` mode
a pull reads with your token and charges `quotaProject`, a project of yours; in `sa` mode the instance's
service account reads, where its operator turned that on, after its gate checked you may see the scope
([modes.md](modes.md)). A pull and an export read, each saved as a file the app (and the render API) can read:

```sh
curl -s -H 'X-Gcportrait-Token: YOUR_ACCESS_TOKEN' -o pull.ndjson \
  --json '{"scope":"organizations/YOUR_ORG_ID","contentType":"RESOURCE","mode":"user","quotaProject":"YOUR_QUOTA_PROJECT"}' \
  https://YOUR_INSTANCE/api/assets/stream
curl -s -H 'X-Gcportrait-Token: YOUR_ACCESS_TOKEN' -o export.ndjson \
  --json '{"gcsUri":"gs://YOUR_BUCKET/export/"}' https://YOUR_INSTANCE/api/export/read
```

The two streams answer 200 once they start; what Google says after that arrives as an `error` frame
(`{"t":"error","message":…,"status":403,"code":"PERMISSION_DENIED","reason":…}`) on the last line.

## POST /api/render

Draws one view of one snapshot, with the code `pnpm render` runs: the same view gives the same bytes, a PNG is
the app's export (2× by default, a 24 px margin, the theme's canvas colour), and a draw.io file is the same
drawing as cells diagrams.net can edit ([below](#drawio-files)). The request is one JSON document:

| Field | Default | |
|---|---|---|
| `source` | required | Where the data comes from (next table). |
| `view` | `{}` | `{ "hash": "…" }`, the part of an app link after `#` (its `snapshot`, `selection` and `highlight` do not change the drawing; a `tick` is refused), or explicit fields: `lens` (default `overview`), `detail` (`auto`, `folders`, `projects`, `networks`, `all`; default `auto`), `focus` (`{ kind, params }`), `root` (a node id to drill into), `filters` (any of the view's filters), `flips` (zone ids to open or close). |
| `format` | `png` | `png`, `svg` or `drawio` (a `.drawio` file for diagrams.net). |
| `theme` | `light` | `light` or `dark`. |
| `scale` / `width` | `scale` 2 | PNG only, one of them: pixels per drawing unit, above 0 and up to 3, or the PNG's width in pixels. |
| `compressed` | `true` | draw.io only: the diagram compressed as diagrams.net saves it, or `false` for its XML as it is (readable and diffable, several times larger). |
| `fontSource` | `true` | draw.io only: every label names Google Fonts' stylesheet of Roboto and Roboto Mono, which diagrams.net loads when it opens the file, so the labels keep the drawing's faces; `false` leaves it out (diagrams.net then uses its default font unless Roboto is installed). |
| `viewport` | `{ "width": 1280, "height": 800 }` | The canvas `detail: auto` fits, as the app's window would. |

| `source.kind` | Fields | Data |
|---|---|---|
| `scope` | `scope`, `mode`, `quotaProject`, `readTime?`, `assetTypes?` | A live pull, exactly as `/api/assets/stream` makes it (the same rules, gate and limits). `readTime` draws a past moment within Cloud Asset Inventory's 35 days; `assetTypes` narrows the pull. |
| `ndjson` | `scope?`, `readTime?` | The `file` part: a Cloud Asset Inventory export (`gcloud asset export`, a file of it) or a saved `/api/assets/stream` answer, read as the app imports it. The scope comes from the assets unless given, the read time from `readTime` or else the latest asset change. |
| `bundle` | none | The `file` part: a `.gcportrait.json` snapshot file the app saved; its own day is drawn. |
| `demo` | `size` (`S`, `M`, `L`, `XL`) | A synthetic demo organisation, as `pnpm render --fixture` draws it. |

`scope` and `demo` send the document as the JSON body. `ndjson` and `bundle` send `multipart/form-data`: the
document as the field `request`, first, then the file as the part `file` (`curl -F`):

```sh
curl -s -H 'X-Gcportrait-Token: YOUR_ACCESS_TOKEN' -OJ \
  --json '{"source":{"kind":"scope","scope":"folders/YOUR_FOLDER_ID","mode":"user","quotaProject":"YOUR_QUOTA_PROJECT"},"view":{"lens":"networking"}}' \
  https://YOUR_INSTANCE/api/render
curl -s -H 'X-Gcportrait-Token: YOUR_ACCESS_TOKEN' -o demo-m.svg \
  --json '{"source":{"kind":"demo","size":"M"},"view":{"hash":"lens=networking&detail=networks"},"format":"svg","theme":"dark"}' \
  https://YOUR_INSTANCE/api/render
curl -s -H 'X-Gcportrait-Token: YOUR_ACCESS_TOKEN' -OJ \
  -F 'request={"source":{"kind":"ndjson"},"scale":3}' -F 'file=@export.ndjson' https://YOUR_INSTANCE/api/render
curl -s -H 'X-Gcportrait-Token: YOUR_ACCESS_TOKEN' -OJ \
  -F 'request={"source":{"kind":"bundle"},"format":"svg"}' -F 'file=@snapshot.gcportrait.json' \
  https://YOUR_INSTANCE/api/render
curl -s -H 'X-Gcportrait-Token: YOUR_ACCESS_TOKEN' -OJ \
  --json '{"source":{"kind":"demo","size":"M"},"format":"drawio"}' https://YOUR_INSTANCE/api/render
```

`-OJ` saves the image under the name the instance gives it, the app's export name. A 200 answer's headers:

| Header | |
|---|---|
| `content-type` | `image/png`, `image/svg+xml; charset=utf-8`, or `application/vnd.jgraph.mxfile` (draw.io) |
| `content-disposition` | `attachment; filename="gcportrait_<scope>_<lens>_<readTime>.<ext>"` |
| `x-gcportrait-view` | The view drawn, as an app link's hash; for a demo it names the snapshot (`snapshot=demo:M&lens=networking&detail=networks`), and `pnpm render --hash` with it draws the same bytes. |
| `x-gcportrait-detail` | The detail level drawn, what `auto` chose. |
| `x-gcportrait-scale` | PNG only: the scale used, lower than asked when the PNG would pass `RENDER_MAX_PIXELS` (`pnpm render --scale` with it draws the same bytes). |

The drawing is the app's: its title block holds the scope, the lens with the read time (written in UTC) and
the tagline. Renders run one at a time per instance, so a script retries a `429 RENDER_BUSY` after its
`Retry-After`, as it does every answer marked `retryable`.

### draw.io files

`"format": "drawio"` answers a `.drawio` file (`gcportrait_<scope>_<lens>_<readTime>.drawio`) that
[diagrams.net](https://app.diagrams.net) (draw.io) opens as an editable diagram looking like the PNG and the
SVG. It is not drawn a second time: the SVG of the view is translated into draw.io's cells, so every zone,
card, line and label is where the picture has it, in the same colours, strokes, dashes and fonts:

- zones are containers, nested as in the drawing, each with its title as its label, so moving a zone moves
  what it holds; cards, chips and collapsed zones are groups of their body, their icon (Google's icon as an
  embedded SVG image, unaltered) and one text cell of their lines;
- lines connect their two nodes, with the drawing's bends as waypoints and their heads and dashes;
- three layers: "Diagram" (zones and nodes), "Connections" (the lines) and "Title and legend" (the title
  block's three lines and the legend);
- the page's background is the theme's canvas colour, and the file turns off diagrams.net's adaptive colours
  (`adaptiveColors="none"`), so it looks the same in diagrams.net's light or dark interface; the file's
  `modified` is the data's read time, and the same view gives the same bytes.

The diagram is compressed as diagrams.net saves it (the XML URI-encoded, deflated, base64); `"compressed":
false` (or `pnpm render --drawio-plain`) writes the XML itself. With `fontSource` (the default) each label
names Google Fonts' stylesheet of Roboto and Roboto Mono: the instance fetches nothing, it is your
diagrams.net that loads the faces from Google Fonts when it opens the file.

To open a file in diagrams.net, use File, Open from, Device, or give it a public URL of the file:
`https://app.diagrams.net/?url=` followed by the URL-encoded address of a `.drawio` file anyone can read (a
public bucket's object, a raw file in a public repository).

## Errors

Every error is JSON, sent before any byte of an image: `{ statusCode, error, message, requestId, code,
retryable?, reason?, upstream? }`. `message` is for people and names a field, never the value sent; `code` is
for scripts; `reason` is Google's `ErrorInfo` reason when Google refused (such as `SERVICE_DISABLED`). Every
429 and every error with `retryable: true` carries `Retry-After`, in seconds: wait that long, then send the
same request again.

| Status | `code` | When |
|---|---|---|
| 400 | `INVALID_REQUEST` | The body does not fit the route's schema (unknown fields are refused), or a render's upload is not readable multipart (no boundary, cut short). |
| 401 | `UNAUTHENTICATED` | No token, a malformed one, or one Google does not accept; with `WWW-Authenticate: Bearer`. |
| 403 | `SA_MODE_OFF`, a gate code (`SA_GATE_CALLER_DENIED`, …), or Google's (`PERMISSION_DENIED`) | Service-account mode off or refused, or Google refused the read. |
| 404 | `NOT_FOUND` | Google found no such scope, or none at that `readTime`. A route the instance does not have (`RENDER_API=false`; every token route on a demo-only instance) answers the JSON 404 of any unknown path, without a `code`. |
| 408 | `REQUEST_TIMEOUT` | The body, a render's upload included, was still arriving after 30 s; the connection is closed. |
| 413 | `BODY_TOO_LARGE` | A JSON body over 64 KiB, or an upload over `RENDER_MAX_BODY_BYTES`. |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | A render source sent in the wrong body, or an upload without its `file` part. |
| 422 | `INVALID_FILE`, `EMPTY_SNAPSHOT`, `TOO_MANY_ASSETS`, `VIEW_REFUSED` | A file the app could not read either (its message), no assets, more than `RENDER_MAX_ASSETS`, a `root` or `focus` the snapshot does not have. |
| 429 | `RATE_LIMITED`, `STREAMS_BUSY`, `RENDER_BUSY` | Too many requests for the token or address (`Retry-After`: until the minute's window ends), four streams already running for the token (30 s), another render running on the instance (10 s). |
| 501 | `SA_MODE_UNAVAILABLE` | Service-account mode asked of a build without the instance's identity. |
| 502, 503, 504 | `UPSTREAM_UNREACHABLE`, `INSTANCE_BUSY`, `UPSTREAM_TIMEOUT`, `BAD_UPSTREAM_ANSWER`, Google's code | Google could not be reached or answered with an error after the retries; `retryable` ones with `Retry-After` (10 s, 30 s for `INSTANCE_BUSY`). |
| 503 | `SA_GATE_UNAVAILABLE`, `SA_CREDENTIALS_UNAVAILABLE`, `TOKEN_CHECK_UNAVAILABLE` | Google did not answer the service-account gate's check, the instance could not get its account's token, or Google's token check did not answer: `retryable`, `Retry-After` 10 s. |
| 503 | `RENDER_TIMEOUT`, `RENDER_TOO_LARGE` | The render passed `RENDER_TIMEOUT_MS` or the render worker's memory; not retryable as it is: narrow the data or the view. |
| 500 | `INTERNAL` | A bug: `Internal error.` and the request id; the details are in the instance's log. |

The streaming routes answer the 400 to 501 rows before they start; the `code` field is the render route's.

## Limits

| Limit | Value |
|---|---|
| Requests per client address | 600 a minute, every route but `/healthz` |
| Per token | 120 scope searches, 30 preflights, 30 streams per stream route, 10 renders, each a minute; four streams at once |
| Bodies | JSON up to 64 KiB, sent within 30 s; a client must take each 1 MiB piece of an answer within 60 s |
| Live pull | 60 s and 25 MiB per page, 64 MiB of pages in memory per instance |
| Render | one at a time per instance; `scale` up to 3; 16 384 px a side; `RENDER_MAX_ASSETS` (60 000), `RENDER_MAX_PIXELS` (2^26), `RENDER_TIMEOUT_MS` (300 s), `RENDER_MAX_BODY_BYTES` (25 MiB), each set by the operator ([configuration.md](configuration.md#backend-environment)); the pixel limits are a PNG's only, an SVG or a draw.io file has none |

A render keeps the instance's CPU busy and needs memory for its PNG: demo XL at `detail: all` and `scale` 3
needs about 1.4 GiB and minutes of CPU even on a fast machine, so on Cloud Run's one vCPU a large render can
approach `RENDER_TIMEOUT_MS`, and `x-gcportrait-scale` says when the scale was lowered to fit
`RENDER_MAX_PIXELS`. `RENDER_API=false` (`deploy.sh --no-render-api`) turns the route off where nobody needs
it. Any Google account's token passes the render route's token check for the `demo`, `ndjson` and `bundle`
sources: on a public instance, keep `--max-instances` low or put Identity-Aware Proxy in front
([self-host-options.md](self-host-options.md#private-instance-identity-aware-proxy)). An upload must pass
Cloud Run's 32 MiB request limit and arrive within 30 s (else `408`); read larger scopes with `scope`.
