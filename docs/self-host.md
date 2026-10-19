<!-- SPDX-License-Identifier: Apache-2.0 -->

# Self-hosting gcportrait

A gcportrait instance is one Cloud Run service in a Google Cloud project of yours: the app and a small
stateless backend that keeps nothing, no database, no bucket, no stored token. Everyone signs in with their
own Google account and sees only what their own IAM permissions allow. This page takes you there in three
steps. [self-host-options.md](self-host-options.md) covers everything optional (another region, a private
instance, service-account mode, a demo-only instance, a custom domain, legal pages, building from source,
troubleshooting), and [configuration.md](configuration.md) lists every flag and variable with its default.

## Get started right away

You need a Google Cloud project with billing enabled in which you are Owner (or hold [the roles deploy.sh
needs](self-host-options.md#permissions-to-run-deploysh)), and a terminal with the [Google Cloud
CLI](https://cloud.google.com/sdk/docs/install), bash, curl and tar: macOS, Linux and [Cloud
Shell](https://shell.cloud.google.com/) have them. No clone of the repository, no Docker, no Node.

### 1. Deploy

Sign in to the Google Cloud CLI, then run the installer with your project id, the one thing it asks for:

```sh
gcloud auth login
curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project YOUR_PROJECT
```

The installer downloads the deploy scripts of the newest release, checks their SHA-256 against the release's
`checksums.txt` and runs nothing when a download or the check fails. It keeps the scripts in a folder
`gcportrait-vX.Y.Z` in the current directory and runs that release's `infra/deploy.sh`, which enables the APIs
the instance needs, creates its service account without any role, deploys the release's image as the Cloud Run
service `gcportrait` in `europe-west3` and checks that it answers. Add `--dry-run` to the line to see every
change first. Everything else is optional and has a default ([self-host-options.md](self-host-options.md)):
add its flag to the same line.

When it is done, open the address it prints: "Try the demo" works at once, and "Sign in with Google" shows as
not configured until step 3.

### 2. Create the OAuth client

"Sign in with Google" needs an OAuth client of your own. Google offers no API for creating one, and the client
needs the instance's address, so this one step comes after the first deploy, in the Google Cloud console.
deploy.sh ends with its "Next steps", which name the link,
`https://console.cloud.google.com/auth/clients?project=YOUR_PROJECT`, and the exact origins to add.

1. Open the link. The first time, choose **Get started** to set up the consent screen: app name `gcportrait`,
   your email address for support and contact, and the audience. Choose **Internal** when only accounts of
   your own Google Workspace or Cloud Identity organisation will sign in; choose **External** otherwise, which
   starts in testing, where only the test users you list (up to 100) can sign in: add your own address under
   **Audience** › **Test users**. Accept the User Data Policy and choose **Create**.
2. **Data Access** › **Add or remove scopes** › **Manually add scopes**: paste the three scopes, choose **Add
   to table**, then **Update** and **Save**:

   ```text
   https://www.googleapis.com/auth/cloud-platform.read-only
   https://www.googleapis.com/auth/cloudasset
   https://www.googleapis.com/auth/userinfo.email
   ```

3. **Clients** › **Create client**, type **Web application**. Under **Authorised JavaScript origins**, add
   each origin deploy.sh printed, exactly as printed: the instance's address,
   `https://gcportrait-PROJECT_NUMBER.europe-west3.run.app`, with no path and no trailing slash. Add no
   redirect URI. Choose **Create** and copy the **Client ID**; you do not need the client secret.

[The OAuth client in detail](self-host-options.md#the-oauth-client-in-detail) has every screen, the reasons
for each setting, and what to do when sign-in fails.

### 3. Redeploy with the client id

Run the line of step 1 again with the client id added:

```sh
curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project YOUR_PROJECT --oauth-client-id YOUR_OAUTH_CLIENT_ID
```

deploy.sh is declarative: every run sets the instance to what its flags say, so repeat any other flag you gave
in step 1. The installer uses the folder it kept when no newer release is out, and deploys the newer one when
there is. To stay on exactly the release you installed, run the redeploy deploy.sh printed instead (step 3 of
its "Next steps", `gcportrait-vX.Y.Z/infra/deploy.sh --image vX.Y.Z ... --oauth-client-id CLIENT_ID`). To show
people who runs the instance before they sign in ("Hosted by …"), add `--hosted-by "NAME"` with your team's or
company's name: plain text, at most 80 characters, never naming Google.

Open the address again: "Sign in with Google" works.

## Use it

Sign in, pick a scope (an organisation, folder or project), run the permission check and pull. Each person
reads with their own Google account, so nobody sees more than their own IAM roles allow. To read a scope, an
account needs `roles/cloudasset.viewer` on it, and a quota project that has the Cloud Asset API on and that it
may use; the instance's project works for its Owner. Your own project is the simplest test scope:

```sh
gcloud projects add-iam-policy-binding YOUR_PROJECT --member="user:YOUR_EMAIL" --role="roles/cloudasset.viewer"
```

The app's Permissions page shows the exact commands for any scope and account, and
[permissions.md](permissions.md) explains each one. For a team that wants to grant read access once instead of
to every person, see [Service-account mode](self-host-options.md#service-account-mode).

## What you got

- **The Cloud Run service `gcportrait`** in `europe-west3`, public: opening it shows the app, and reading any
  Google Cloud data needs a person's own sign-in and roles. It scales to zero when nobody uses it.
- **Its service account**, `gcportrait-backend@` and your project id, with no role at all, on nothing.
  deploy.sh prints it as "Service account".
- **An Artifact Registry remote repository `ghcr`** in the region, which pulls the released image from GitHub
  Container Registry once and keeps a copy, so a redeploy does not depend on GitHub.
- **The APIs it enabled**: Cloud Run, IAM, Cloud Asset Inventory, Resource Manager and Artifact Registry.
- Nothing else: no database, no bucket, no service-account key, no secret. [What deploy.sh
  does](self-host-options.md#what-deploysh-does) lists every step.

Idle, the instance costs only the storage of the image copy, because Cloud Run scales to zero. In use, Cloud
Run bills per request-second, and Cloud Asset Inventory and Resource Manager calls are free of charge within
their quotas ([Costs](self-host-options.md#costs)).

## Updating

Run the installer line again with the flags you deploy with. It keeps the newest release's scripts in a folder
of their own, beside the old ones, and deploys that release's image:

```sh
curl -fsSL https://gcportrait.app/install.sh | bash -s -- --project YOUR_PROJECT --oauth-client-id YOUR_OAUTH_CLIENT_ID
```

Add `--version vX.Y.Z` (from the [releases](https://github.com/florianchrometz/gcportrait/releases)) to deploy
that release instead of the newest, an older one too to roll back. With the scripts you have, `infra/deploy.sh
--image vX.Y.Z` with your flags, run in the installer's folder, deploys release vX.Y.Z the same way.
[Updating, pinning and rolling back](self-host-options.md#updating-pinning-and-rolling-back) has the image
tags and Cloud Run's own revisions.

## Uninstall

In the folder the installer kept:

```sh
cd gcportrait-vX.Y.Z
infra/uninstall.sh --project YOUR_PROJECT
```

It asks you to type the service name, then deletes exactly what deploy.sh created: the service, its account
and, with the last instance of the region, the remote repository. If you deployed with `--region` or
`--service`, give the same ones; the last line deploy.sh printed, "Remove everything this script created",
names all three. The APIs stay enabled unless you add `--disable-apis` ([Uninstall in
detail](self-host-options.md#uninstall-in-detail)). The OAuth client is yours to delete in the console (Google
Auth Platform › Clients).
