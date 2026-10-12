---
'@gcportrait/website': patch
'@gcportrait/backend': patch
---

The self-hosting guide is one quick start in three steps: deploy with the installer line and your project id (or the "Open in Cloud Shell" tutorial), create the OAuth client (the console link, the origins deploy.sh prints, the three scopes, the audience), and redeploy with the installer line plus `--oauth-client-id`; then using the instance, what it created, updating and uninstalling. Everything optional moved to a new page, "Self-host options" (`/docs/self-host-options/`), each option with its flag, its default and an example: the installer's own options and limits, region and service name, memory, "Hosted by", the OAuth client in detail, Identity-Aware Proxy, service-account mode, a demo-only instance, a custom domain, legal pages, the render API, versions, building from source (the Cloud Run Button, `--build` from a clone, the image locally), what deploy.sh does, uninstall, costs, logs and troubleshooting. The maintainer's release setup moved to the contributing guide. deploy.sh now tells a demo-only deploy without legal pages how to add them once, in its next steps, instead of twice.
