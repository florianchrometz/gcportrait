<!-- SPDX-License-Identifier: MIT -->

# Getting started

gcportrait draws a Google Cloud organisation, folder or project as an architecture diagram from Cloud Asset
Inventory data, three ways: self-hosted in a Google Cloud project of yours ([self-host.md](self-host.md)), as
a web app, and through an API that returns any view as SVG, PNG or draw.io ([api.md](api.md)). The quickest
way to see what it does is the web app's demo mode: synthetic organisations generated in your browser, with no
Google account, no backend call and nothing to install. This page gets you there in two minutes, then points
to the guide for each next step.

## 1. Try the demo

Open <https://gcportrait.app/demo/>. It is a static build of the app in demo-only mode, served by the website:
no sign-in, no server, and only the four demo organisations, which your browser generates itself ([modes.md,
"The demo"](modes.md#4-the-demo)).

Or run the released image on your machine, with Docker (or a compatible runtime), and open
<http://localhost:8080>:

```sh
docker run --rm --publish 127.0.0.1:8080:8080 ghcr.io/florianchrometz/gcportrait:latest
```

To run it from the source instead, [contributing.md](contributing.md) has the setup (`pnpm dev:demo`).

The app works on a phone, a tablet and a desktop with the same controls. On a phone or a tablet the top bar's
controls are behind View and More, and on the diagram one finger pans, two pinch to zoom, a tap selects, a
double tap zooms in, and pressing and holding a node shows what resting a mouse on it shows
([faq.md](faq.md#does-it-work-on-a-phone-or-a-tablet) says what a touch screen does and does not do there).

## 2. A first tour

1. On the Connect page, pick a size (S about 100 assets, M about 1 000, L about 6 000, XL about 50 000) and
   press "Try the demo". M is a good start: it holds every product group's prominent types.
2. **Lenses.** The Lens menu in the top bar redraws the same organisation for one question: Networking, Load
   balancing, Compute, Data and more. Focus, Filters and Detail narrow it further
   ([lenses and filters](lenses-and-filters.md)).
3. **Trace.** Hover a resource: its path to the top of the organisation lights up. Click it: its connections
   stay highlighted, the details drawer opens, and "Open in Cloud Console" would open its console page in a
   real environment.
4. **Drill in and search.** Click a collapsed zone to open it, double-click a project or folder to make it the
   whole canvas (the breadcrumb leads back), press `/` and type a name or an IP address such as `10.0.14.5`.
5. **Timeline.** Drag the slider at the bottom, or press `[` and `]`, to move through the demo's 35 days; each
   day marks what was added, removed or changed since the day you came from
   ([the timeline](timeline.md)).
6. **Export.** The Export menu saves the view as SVG, PNG or an editable draw.io file ([export](export.md));
   "Copy link" shares it, since every view lives in the address.

## 3. Next steps

| You want to | Read |
|---|---|
| Understand the ways gcportrait reads Google Cloud: your account, a service account, export files, the demo | [Modes](modes.md) |
| Know which roles reading a scope needs, with the exact `gcloud` commands | [Permissions](permissions.md) |
| Run gcportrait on Cloud Run in your own Google Cloud project, in about 10 minutes | [Self-host](self-host.md) |
| Look up a setting of an instance | [Configuration](configuration.md) |
| Find an answer quickly | [FAQ](faq.md) |

There is no hosted instance you sign in to: to read your own Google Cloud, you deploy your own with one line
and your project id ([self-host.md](self-host.md)). Your snapshots stay in your browser.
