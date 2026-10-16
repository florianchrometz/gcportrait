# Deploy gcportrait to your Google Cloud project

<walkthrough-tutorial-duration duration="10"></walkthrough-tutorial-duration>

<!-- SPDX-License-Identifier: MIT -->

<!--
  The guided path of docs/self-host.md, as a Cloud Shell tutorial: the "Open in Cloud Shell" button in
  README.md and docs/self-host.md clones the repository into Cloud Shell and opens this file in the tutorial
  panel. The H1 is the title and every H2 a step (Cloud Shell's tutorial format); <walkthrough-...> tags are
  Cloud Shell directives. Commands name the project as {{project-id}}, which Cloud Shell replaces with the
  project chosen in the "Choose a project" step: the form Google's own tutorials use in commands, in
  github.com/GoogleCloudPlatform/cloud-shell-tutorials. scripts/infra.test.ts runs every deploy.sh and
  uninstall.sh command here against stand-ins.
-->

## Your own gcportrait

gcportrait draws a Google Cloud organisation, folder or project as an architecture diagram, from Cloud Asset
Inventory data. This tutorial puts an instance of your own on Cloud Run in a project of yours and connects
"Sign in with Google" to it: everyone who signs in sees only what their own Google Cloud roles allow.

**Time to complete**: about 10 minutes.

**You need**: a Google Cloud project with billing enabled in which you are Owner, or the right to create one.

**Cost**: the instance scales to zero when nobody uses it. Artifact Registry keeps a copy of the image (some
tens of MB), and Cloud Asset Inventory reads are free of charge within their quotas.

Click **Start** to begin.

<walkthrough-footnote>gcportrait renders Google Cloud-style architecture diagrams. It is an independent
open-source project and is not affiliated with, endorsed by, or sponsored by Google. Google Cloud and the
Google Cloud product icons are trademarks of Google and are used under Google's icon usage
terms.</walkthrough-footnote>

## Sign in to the Google Cloud CLI

Cloud Shell opened this repository in a temporary environment without your Google credentials, as it does for
every repository that Google does not own. Sign in once; follow the link, choose your account and paste the
code back into the terminal:

```sh
gcloud auth login
```

## Choose a project

Choose the project that will run gcportrait, or create one. Cloud Run needs billing on it.

<walkthrough-project-setup billing="true"></walkthrough-project-setup>

Then point the Google Cloud CLI at it:

```sh
gcloud config set project {{project-id}}
```

## Deploy

`infra/deploy.sh` needs the project id and nothing else. It enables the APIs the instance needs, creates its
service account (with no role at all), pulls the newest release of gcportrait from GitHub Container Registry
through an Artifact Registry remote repository, deploys the Cloud Run service in `europe-west3` and checks
that it answers. Expect a few minutes; deploy.sh names each step as it goes:

```sh
infra/deploy.sh --project {{project-id}}
```

Every other flag is optional: add `--region REGION` for another region, or `--dry-run` to see every change
first. To build this checkout instead of deploying the release (Cloud Build in your project, a few minutes
more):

```sh
infra/deploy.sh --project {{project-id}} --build
```

When it is done, deploy.sh lists three next steps: open the address, create the OAuth client, redeploy with
its id. The next three steps of this tutorial are those.

## Open your instance

Open the address deploy.sh printed as its first next step, `https://gcportrait-PROJECT_NUMBER.europe-west3.run.app`.
"Try the demo" works at once, without a Google account. "Sign in with Google" shows as not configured until
the last of these steps.

## Create the OAuth client

"Sign in with Google" needs an OAuth client of your own: the one step Google offers no command for, and it
needs the address, so it comes after the deploy. deploy.sh printed the link to your project's clients page and
the exact origins to paste; the link is also:

```sh
echo "https://console.cloud.google.com/auth/clients?project={{project-id}}"
```

1. The first time, choose **Get started**: app name `gcportrait`, your email address, audience **Internal**
   (only accounts of your own organisation) or **External** (test users you list), then **Create**.
2. Under **Data Access**, add these scopes: `https://www.googleapis.com/auth/cloud-platform.read-only`,
   `https://www.googleapis.com/auth/cloudasset` and `https://www.googleapis.com/auth/userinfo.email`.
3. Under **Clients**, choose **Create client**, type **Web application**, and add each origin deploy.sh listed
   as an **Authorised JavaScript origin**, exactly as printed. No redirect URI. Copy the **Client ID**.

## Redeploy with the client id

Run the command deploy.sh printed as its third next step, with your client id in place of `CLIENT_ID`. It is
the first run's command plus `--oauth-client-id`: deploy.sh is declarative, every run sets the instance to its
flags, so keep any flag of the first run (after `--build`, the printed command deploys the image it built
instead of building again):

```sh
infra/deploy.sh --project {{project-id}} --oauth-client-id CLIENT_ID
```

Open the address again and choose **Sign in with Google**.

## Read your project

To read a scope, your account needs `roles/cloudasset.viewer` on it. Your own project is the simplest test:

```sh
gcloud projects add-iam-policy-binding {{project-id}} \
  --member="user:$(gcloud config get-value account)" \
  --role=roles/cloudasset.viewer
```

Open the address, choose **Sign in with Google**, pick the project as the scope, run the permission check and
choose **Pull now**. The diagram opens; the timeline at the bottom goes back 35 days.

## Clean up

To remove the instance again, run uninstall.sh. It asks you to type the service name, then deletes exactly
what deploy.sh created. The OAuth client is yours to delete in the console.

```sh
infra/uninstall.sh --project {{project-id}}
```

## Done

<walkthrough-conclusion-trophy></walkthrough-conclusion-trophy>

Your instance runs on Cloud Run, reads Google Cloud with each person's own sign-in and stores nothing on the
server. The self-hosting options,
<walkthrough-editor-open-file filePath="docs/self-host-options.md">docs/self-host-options.md</walkthrough-editor-open-file>,
cover service-account mode for teams, a private instance behind Identity-Aware Proxy, custom domains, updates
and costs.
