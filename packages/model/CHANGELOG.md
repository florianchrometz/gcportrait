# @gcportrait/model

## 1.0.0

### Major Changes

- The first release of gcportrait.
  
  gcportrait renders Google Cloud-style architecture diagrams. It is an independent open-source project and is
  not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the Google Cloud product icons are
  trademarks of Google and are used under Google's icon usage terms.
  
  ### Highlights
  
  - **Architecture diagrams from real data.** gcportrait draws an organisation, a folder or a project from Cloud
    Asset Inventory as a Google Cloud-style architecture diagram: folders, projects, VPC networks, subnetworks
    and clusters nest as tinted zones, resources are cards with Google Cloud's product icons, and every
    reference between them is an orthogonal arrow routed through the gaps, never across a card or a title.
  - **A 35-day timeline** moves any view through the last 35 days and marks what was added, removed or changed
    since the day you came from.
  - **SVG and PNG export** of the current view, in either theme, with a title block and a legend.
  - **A demo mode with no account**: four synthetic organisations from about 100 to about 50 000 assets, each
    with a 35-day history, generated in the browser; try it at
    [gcportrait.app/demo/](https://gcportrait.app/demo/), a static build of the app.
  - **Self-hosting on Cloud Run** in a project of yours: one script deploys a released image or builds your
    checkout, and removes exactly what it created.
  - **A render API**: `POST /api/render` returns any view of a scope, an export or snapshot file, or a demo
    organisation as SVG or PNG, without the app.
  - **Your inventory stays in your browser**: snapshots live in IndexedDB and leave it only as files you export;
    the backend streams and keeps nothing.
  
  ### Diagrams
  
  - Eleven lenses (Overview, Networking, Load balancing, Compute, Data and more) redraw the same organisation
    for one question; five focus views (a single project, a Shared VPC, standalone projects, a perimeter, an
    application) and filters by region, project, folder, type, depth and more narrow it down. Every choice is
    part of the link, so a reload, Back or a shared link shows the same view, and views can be saved in the
    browser.
  - Large organisations open collapsed: projects and zones become chips that count what they hold. A click
    expands a chip in place, a double-click drills into a container, the breadcrumb leads back out, and "N of M
    shown" says how much is drawn. A view of at most 100 boxes always opens whole.
  - Click a resource and its path to the top and its connections stay traced, a load balancer's whole chain
    included; hovering previews the trace. "Open in Cloud Console ↗" opens the resource's console page (or its
    project's) only when you choose it.
  - The details drawer lists a resource's facts, its relations by kind with links, references to resources
    outside the snapshot, what changed on the day shown, and its raw data.
  - Search (`/`) finds any asset by name, IP address, domain, project id or type; Enter selects it, opens the
    zones around it and glides to it, and a dialog offers a way to show it when the view leaves it out.
  - Light and dark themes for the app and the diagrams, Google's product icons unaltered; contrast is tested in
    both themes, the keyboard reaches every item of the diagram, and axe reports no violations on any page in
    either theme. gcportrait is built for desktop browsers (1280 × 800 or larger).
  
  ### Timeline
  
  - 35 daily ticks at 00:00 UTC with a slider, step buttons, `[` and `]`, and playback at 0.5, 1 or 2 seconds a
    day. The day is part of the link.
  - Added resources are outlined, removed ones stand as dashed ghosts where they were, changed ones carry a dot;
    the drawer's "What changed" names the fields that differ.
  - A demo organisation's days come from its history. For a scope read from Google Cloud, a day is read from
    Cloud Asset Inventory when you stop on it (its neighbours while the page is idle) and kept in the browser.
  - Every stored export and manual pull of the same scope appears as an extra tick between the days.
  
  ### Export and the command line
  
  - The Export menu saves SVG or PNG (2× or 3×), the whole diagram or the visible part, or copies the PNG. The
    SVG opens on its own in browsers and editors; the file name is `gcportrait_<scope>_<lens>_<readTime>.<ext>`.
  - `pnpm render --fixture M --lens networking --png out.png` draws a demo view without a browser, byte for byte
    as the app draws it; `pnpm render-scene` prints a view's summary.
  - The render API, `POST /api/render`, draws a view of a scope you can read, an uploaded export or snapshot
    file, or a demo organisation as SVG or PNG on the server, byte for byte what `pnpm render` draws, with your
    own token in `X-Gcportrait-Token`. It is on by default (`RENDER_API`), one render at a time per instance with
    fixed limits, and never on a demo-only instance ([docs/api.md](https://github.com/florianchrometz/gcportrait/blob/main/docs/api.md)).
  
  ### Reading your Google Cloud
  
  - Sign in with Google on an instance that names an OAuth client. The access token stays in the tab's memory:
    it is never stored, logged or put in a URL, and signing out revokes it.
  - The scope picker finds the organisations, folders and projects you can see. The Permissions page checks a
    scope before it is read and gives a copy-ready `gcloud` command for every missing grant, the quota project
    included; the values to fill in (`YOUR_PROJECT_ID`, `YOUR_EMAIL`, …) are fields inside the command, and Copy
    takes the command with what you typed.
  - "Pull now" streams the scope from Cloud Asset Inventory into a snapshot in the browser, with progress and
    Cancel. "Load export" reads a Cloud Asset Inventory export from dropped files or from Cloud Storage.
  - Service-account mode lets a team grant the instance's own account `roles/cloudasset.viewer` once; a gate
    checks each person's own access to the scope before the account reads it (a pass is remembered for at most
    five minutes) and writes an audit line without the token.
  - The Snapshots page lists, loads, exports, imports and deletes snapshots and shows the storage they use.
  
  ### Self-hosting
  
  - `infra/deploy.sh --project YOUR_PROJECT` enables the APIs, creates a service account with no role and
    deploys the newest release from GitHub Container Registry (`ghcr.io/florianchrometz/gcportrait`, linux/amd64
    and linux/arm64), pulled through an Artifact Registry remote repository in your project; `--image vX.Y.Z`
    pins a release and `--build` builds your checkout with Cloud Build instead. `--dry-run` prints every change
    first, and the script never uses or changes a resource it did not create.
  - Options for sign-in (`--oauth-client-id`), service-account mode (`--sa-mode`), Identity-Aware Proxy
    (`--iap`), a sign-in-free demo-only instance (`--demo-only`), a custom domain (`--domain`), links to your
    Impressum and privacy notice (`--impressum-url`, `--privacy-url`) or legal pages served by the instance
    (`--legal-dir`), and the render API (2 GiB instances by default, `--memory`, `--render-env`,
    `--no-render-api`). `infra/uninstall.sh` removes exactly what deploy.sh created.
  - An "Open in Cloud Shell" tutorial and a "Run on Google Cloud" button sit next to the manual steps.
  - The image is distroless and runs as a non-root user; `pnpm docker:build` and `pnpm docker:run` start it
    locally. Each GitHub release attaches an SPDX SBOM per platform.
  
  ### Security and privacy
  
  - The backend is stateless and not an open proxy: it calls a fixed list of Google hosts, validates every
    request body, limits requests per address and per token, caps streams and memory, and disconnects clients
    that stop reading. Strict security headers, a Content Security Policy and a Permissions-Policy on every
    response.
  - The security review and the threat model are in [docs/security.md](https://github.com/florianchrometz/gcportrait/blob/main/docs/security.md) and
    [docs/threat-model.md](https://github.com/florianchrometz/gcportrait/blob/main/docs/threat-model.md); CI fails on high and critical dependency advisories
    unless one is accepted with an expiry.
  - Every build ships the third-party notices (`/licenses/THIRD_PARTY_NOTICES.txt`), linked from the Settings
    page.
  
  ### The asset catalog
  
  - 632 of the 641 asset types Cloud Asset Inventory lists are described as data, with 1 387 rules for what they
    reference, each proven by a synthetic fixture; the other 9 are listed with a reason. A type the catalog does
    not know still renders.
  - Weekly workflows report changes to the official asset-type list and to Google Cloud's product icons.
  
  ### Website and docs
  
  - The website for gcportrait.app, on GitHub Pages: a landing page with animated demos in both themes, the user
    guides with fillable commands, the asset-type coverage, sample exports, the changelog, an author section, and
    the static demo at `/demo/`. Its footer, like the app's, links the Impressum and the privacy notice on the
    maintainer's website; there are no terms of use, because there is no account and no service. One mark,
    `brand/icon.svg`, is the favicon of the website and the app and the website's logo.
  - User guides in `docs/`: getting started, modes, permissions, lenses and filters, timeline, export, FAQ,
    self-host, configuration and the API, each with the date it was last verified.
  
  ### Known limitations
  
  - Not yet tried on a real instance: signing in with your own account behind Identity-Aware Proxy (`--iap`),
    and `infra/uninstall.sh --disable-apis`. The "Open in Cloud Shell" tutorial and the "Run on Google Cloud"
    button have not been tried end to end yet.
  - Desktop browsers only (1280 × 800 or larger) for the app; the website also serves phones.
  - The timeline covers the last 35 days, the window Cloud Asset Inventory keeps.
  - Open items, decisions still to take and planned work are listed in
    [docs/backlog.md](https://github.com/florianchrometz/gcportrait/blob/main/docs/backlog.md).
  
  ### Licence
  
  gcportrait's own work, its code, its texts and its images, is licensed under the MIT License (`MIT`) from this
  release on, copyright (c) 2026 Florian Chrometz ([LICENSE](https://github.com/florianchrometz/gcportrait/blob/main/LICENSE)).
  The gcportrait name and the gcportrait icon are not covered by the MIT License: they identify this project and may
  not be used to present other software or services as gcportrait or as endorsed by it; forks must use their own name
  and icon ([brand/LICENSE.md](https://github.com/florianchrometz/gcportrait/blob/main/brand/LICENSE.md)). The app
  links its source with the "Source (MIT)" link on every page (`SOURCE_URL`, `VITE_SOURCE_URL`), a courtesy the
  licence does not ask for. Contributions are accepted under the MIT License, with no contributor licence agreement.
  Third-party material keeps its own licences and is not covered by the MIT License: the npm dependencies, the
  self-hosted Roboto fonts (SIL Open Font License 1.1) and the licence texts are listed in
  [THIRD_PARTY.md](https://github.com/florianchrometz/gcportrait/blob/main/THIRD_PARTY.md), and the Google Cloud product icons are Google Cloud's, provided at
  <https://cloud.google.com/icons> and used as provided
  ([packages/icons/README.md](https://github.com/florianchrometz/gcportrait/blob/main/packages/icons/README.md)).
