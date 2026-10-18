<!-- SPDX-License-Identifier: Apache-2.0 -->

# Permissions: what gcportrait needs to read your Google Cloud

gcportrait only ever reads. It draws an organisation, a folder or a project (the *scope*) from Cloud Asset
Inventory, in one of three ways:

- **with your own account** (user mode, the default): you sign in with Google and gcportrait reads what your
  own roles allow;
- **through the instance's service account** (service-account mode, when the instance offers it): a team
  grants the instance's account read access once, and everyone who can see the scope reads it through that
  account;
- **from an export file** that you made with `gcloud asset export`, dropped into the browser or read from
  Cloud Storage.

The app's Permissions page checks a scope for you and shows the exact commands for anything missing. This page
explains the same rules in one place.
[modes.md](modes.md) compares the three ways with the demo, which needs no permission at all.

| Section | |
|---|---|
| [1. The whole matrix](#1-the-whole-matrix) | Every permission, who needs it, where, and the command. |
| [2. With your own account](#2-with-your-own-account) | Sign-in and Google's consent screen, Cloud Asset Inventory, the quota project. |
| [3. Through the instance's service account](#3-through-the-instances-service-account) | The grant, the gate, its answers, the audit line, the operator's settings. |
| [4. From an export](#4-from-an-export) | Making an export and reading it. |
| [5. What the backend never does](#5-what-the-backend-never-does) | Tokens, logs, hosts. |
| [6. Checking a scope](#6-checking-a-scope) | What the permission check says, item by item, and what to do. |
| [7. Removing access again](#7-removing-access-again) | Signing out, revoking, removing grants. |

## 1. The whole matrix

`YOUR_SCOPE_ID` is the organisation number, the folder number or the project id. Use the command group of the
scope's kind: `gcloud organizations`, `gcloud resource-manager folders` or `gcloud projects`. The commands
below use an organisation; the Permissions page writes the right group and shows each value as a field to fill
in place, prefilled with the scope, your email and the account when it knows them, one value per variable for
every command on the page.

| Mode | Who needs it | What | Where | Role that grants it | Checklist item ([section 6](#6-checking-a-scope)) | Command |
|---|---|---|---|---|---|---|
| your account | you | `cloudasset.assets.listResource` | the scope | `roles/cloudasset.viewer` | List the scope’s assets | `gcloud organizations add-iam-policy-binding YOUR_SCOPE_ID --member="user:YOUR_EMAIL" --role="roles/cloudasset.viewer"` |
| your account | you | `serviceusage.services.use`, and the Cloud Asset API enabled | a *quota project* of yours | `roles/serviceusage.serviceUsageConsumer` | A quota project for Cloud Asset Inventory | `gcloud services enable cloudasset.googleapis.com --project=YOUR_QUOTA_PROJECT` and `gcloud projects add-iam-policy-binding YOUR_QUOTA_PROJECT --member="user:YOUR_EMAIL" --role="roles/serviceusage.serviceUsageConsumer"` |
| your account | you (optional) | `resourcemanager.{organizations,folders,projects}.get` | the scope | `roles/browser` (or Viewer) | See the scope’s details (a warning only) | `gcloud organizations add-iam-policy-binding YOUR_SCOPE_ID --member="user:YOUR_EMAIL" --role="roles/browser"`, only for the scope's name instead of its id |
| service account | you, every time (the gate) | `resourcemanager.{organizations,folders,projects}.get` | the scope | `roles/browser` (or Viewer) | You can see the scope yourself | `gcloud organizations add-iam-policy-binding YOUR_SCOPE_ID --member="user:YOUR_EMAIL" --role="roles/browser"` |
| service account | the instance's account (only with the strict exposure check on) | *not* `resourcemanager.*.get` | the scope | none: the account must not see the scope's details | The service account cannot see the scope’s details on its own | — (remove the account's other roles there) |
| service account | the instance's account `YOUR_SA_EMAIL` | `cloudasset.assets.listResource` | the scope | `roles/cloudasset.viewer`, and nothing more | The service account can list the scope’s assets | `gcloud organizations add-iam-policy-binding YOUR_SCOPE_ID --member="serviceAccount:YOUR_SA_EMAIL" --role="roles/cloudasset.viewer"` |
| export | you | `cloudasset.assets.exportResource` to make the export | the scope | `roles/cloudasset.viewer` | — | `gcloud asset export --organization=YOUR_SCOPE_ID --content-type=resource --output-path=gs://YOUR_BUCKET/export.json` |
| export | you | `storage.objects.get` to read it from Cloud Storage | the bucket | `roles/storage.objectViewer` | — (the read itself says so) | not needed for a file you drop into the browser |

## 2. With your own account

1. **Sign in.** "Sign in with Google" uses Google Identity Services in your browser and asks Google for three
   OAuth scopes, and never the wider `cloud-platform`, which would let a token change what it reaches:

   | Scope | What gcportrait uses it for | Needed |
   |---|---|---|
   | `https://www.googleapis.com/auth/cloud-platform.read-only` | Resource Manager: the scope picker, the scope's details, the service-account gate | yes |
   | `https://www.googleapis.com/auth/cloudasset` | Cloud Asset Inventory: listing assets. Cloud Asset Inventory refuses a token without it (or the wider `cloud-platform`) | yes |
   | `https://www.googleapis.com/auth/userinfo.email` | your email address in the account menu and in the commands the check prints | no |

   Before you sign in, the Connect page says what Google will ask and why:

   > Google will ask you to let gcportrait view your Google Cloud data and your Cloud Asset Inventory data.
   > Google describes the second as “See, edit, configure, and delete your Google Cloud Asset data”;
   > gcportrait only lists assets with it, and can never read more than your own roles allow. The access token
   > stays in this tab’s memory: it is never stored, and signing out revokes it.

   Google's consent screen then lists the permissions in Google's own words, under the name the instance's
   operator gave the OAuth client. If you untick one of the two Cloud scopes (Google lets you choose),
   gcportrait revokes the grant at once and asks you to sign in again and allow both; without the email scope
   sign-in still works, and the commands show `YOUR_EMAIL`. The app sends the token only to its own instance,
   in the `X-Gcportrait-Token` header (not `Authorization`, which Identity-Aware Proxy in front of a private
   instance takes for its own), and the instance forwards it to Google.
2. **Cloud Asset Inventory on the scope.** You need `roles/cloudasset.viewer` there (or a custom role with
   `cloudasset.assets.listResource`). Without it Google refuses the listing: "You cannot list assets in SCOPE,
   or it does not exist."
3. **A quota project.** Every Cloud Asset Inventory request is charged to a project you choose, as gcloud's
   `--billing-project` is: one where the Cloud Asset API is enabled and you hold `serviceusage.services.use`.
   For a project scope the check tries the project itself first, then the project you pick; for an
   organisation or a folder, the project you pick. The instance's own project is never used for your requests.
   The check tells the three failures apart: the project does not exist, you may not use it, or the API is
   disabled there (allow a few minutes after enabling it).
4. **Names (optional).** With `resourcemanager.*.get` on the scope (in Browser and Viewer) the diagram shows
   names; without it, ids. Reading still works.

## 3. Through the instance's service account

Service-account mode is for teams: someone who may grant roles on a scope grants the instance's account read
access once, and people who can see that scope read it through the instance without Cloud Asset Inventory
roles of their own.

### Which account, and who pays

The instance publishes its account in `/api/config`; the Permissions page shows it in its "Service-account
mode" section, and the Connect page names it when you pick "Service account". It is a service account of the
instance (not a person), for example `gcportrait-backend@INSTANCE_PROJECT.iam.gserviceaccount.com`. Requests
in this mode carry no quota project: the account's own project pays, which the self-host script makes the
instance's project (it enables the Cloud Asset API there). You pick no quota project in this mode.

### The grant

Grant the account `roles/cloudasset.viewer` on the scope, and nothing else:

```sh
# An organisation, a folder or a project; YOUR_SA_EMAIL is the account the Permissions page shows.
gcloud organizations add-iam-policy-binding YOUR_ORG_ID \
  --member="serviceAccount:YOUR_SA_EMAIL" --role="roles/cloudasset.viewer"
gcloud resource-manager folders add-iam-policy-binding YOUR_FOLDER_ID \
  --member="serviceAccount:YOUR_SA_EMAIL" --role="roles/cloudasset.viewer"
gcloud projects add-iam-policy-binding YOUR_PROJECT_ID \
  --member="serviceAccount:YOUR_SA_EMAIL" --role="roles/cloudasset.viewer"

# To end it:
gcloud resource-manager folders remove-iam-policy-binding YOUR_FOLDER_ID \
  --member="serviceAccount:YOUR_SA_EMAIL" --role="roles/cloudasset.viewer"
```

If gcloud asks about conditions (the scope's policy has conditional bindings), answer "None" or add
`--condition=None`.

Two things decide how wide the grant opens:

- **Anyone who can see the scope and sign in to the instance can read its whole inventory through the
  account**, including projects inside it they cannot open themselves. That is the point of the mode, so grant
  it where that is what you want.
- **Prefer folders or projects to the whole organisation.** In many organisations every member of the domain
  can see the organisation itself (Google grants the domain `roles/resourcemanager.projectCreator`, which
  includes `resourcemanager.organizations.get`, when an organisation is created). A grant on the organisation
  then opens its whole inventory to every such person who can sign in to the instance.

### The gate

Before the account reads a scope, the instance proves that **you** may see that scope, with your own sign-in:

1. **Your permission.** It asks Google's Resource Manager (`testIamPermissions` on the scope, with your token)
   whether you hold `resourcemanager.organizations.get`, `resourcemanager.folders.get` or
   `resourcemanager.projects.get`, matching the scope. Only an answer that contains that permission passes;
   Google answers an empty set for a scope you may not see and for one that does not exist, and every other
   answer (an error, a refusal by VPC Service Controls, no answer) refuses too.
2. **The account's token**, from the instance's own credentials.
3. **The strict exposure check**, only where the instance's operator turned it on
   (`SA_MODE_STRICT_EXPOSURE=true`; the Permissions page says whether it is on): the account must *not* be
   able to read the scope's details on its own. Google's exact refusal of the account's `get` passes; anything
   else refuses.

Only then does the account list the scope's assets. The gate runs before every request the account makes, the
check on the Permissions page included. A pass is remembered for at most five minutes, in the instance's
memory, for your sign-in and that scope only (never for another sign-in, another scope, or past your token's
own expiry, and never a refusal); a check that is refused ends a remembered pass for the same sign-in and
scope at once. The gate cannot be switched off: an operator can only turn service-account mode off as a whole.

**A public scope passes for everyone.** A permission granted to everyone counts as yours: if a project's
details are public (its `resourcemanager.projects.get` is granted to all users), every signed-in person passes
step 1 for it. Without the strict exposure check, such a scope that granted the account is readable by
everyone who can sign in to the instance. The strict check closes that: a scope whose details the account can
see on its own is refused. It is off by default because it also refuses every scope where the account was
granted more than `roles/cloudasset.viewer` (Viewer, say), which is a common setup. Grant the account only
`roles/cloudasset.viewer`, and only on scopes whose details are not public; operators who cannot rule out
public scopes turn the strict check on.

What the gate's answers mean (the Permissions page words them; the API returns them with a `code`):

| Answer | Code | Meaning | What to do |
|---|---|---|---|
| 403 | `SA_GATE_CALLER_DENIED` | you do not hold the scope's `get` permission (or the scope does not exist) | ask for `roles/browser` on the scope, or read with your own account |
| 403 | `SA_GATE_EXPOSED` | strict check: the account can see the scope's details itself | remove the account's extra roles there, or keep the scope out of service-account mode |
| 403 | `SA_GATE_UNEXPECTED`, `SA_GATE_EXPOSURE_UNEXPECTED` | Google answered something the gate does not understand; it refuses rather than guess | Google's status, reason and message come with it |
| 403 | `ACCESS_TOKEN_SCOPE_INSUFFICIENT` | your sign-in lacks the Google Cloud scope | sign in again and allow it |
| 401 | `UNAUTHENTICATED` | Google did not accept your sign-in | sign in again |
| 503 | `SA_GATE_UNAVAILABLE`, `SA_CREDENTIALS_UNAVAILABLE` | Google did not answer in time, or the instance could not get its account's token | try again; if it goes on, tell the instance's operator |

With a passing gate, the account's own access is checked next: "The service account cannot list assets in
SCOPE" means nobody granted it `roles/cloudasset.viewer` there yet (the grant above).

### Who sees what you did

Each decision of the gate writes one line to the instance's log (`service-account gate`): which request asked
(the permission check or a pull), the scope, the SHA-256 of your email address in lower case, whether it was
allowed or refused and why, and whether a remembered pass answered. Never your token, never your email itself.
The line is written whatever log level the operator chose, short of turning logging off (`LOG_LEVEL=silent`).
An operator who knows an address can find its lines by hashing it: `printf '%s' 'ada@example.com' | shasum -a
256`. That makes the lines pseudonymous, not anonymous.

### For the instance's operator

| Setting | Effect |
|---|---|
| `SA_MODE_ENABLED=true` | offers service-account mode. The backend resolves its Application Default Credentials at start-up and stops with a message if it cannot (no account, or one that cannot mint a token). On Cloud Run that is the service account the service runs as. |
| `SA_MODE_STRICT_EXPOSURE=true` | adds the strict exposure check to the gate (default off, above). Any value other than `true` or `false` stops the backend at start-up, so a typo never leaves the check off unnoticed. |
| `BACKEND_SA_EMAIL` | optional with the mode on: the backend publishes the account its credentials resolve to, and refuses to start if this names another one. |
| `GOOGLE_APPLICATION_CREDENTIALS` | optional: a credentials file to use instead of the metadata server. For a laptop, `gcloud auth application-default login --impersonate-service-account=YOUR_SA_EMAIL` writes the right kind (your account needs `roles/iam.serviceAccountTokenCreator` on the service account). A person's own credentials are refused: the mode reads as a service account. |

Give the account no roles in the instance's project beyond what Cloud Run needs to run it (none for reading),
and nothing that includes `resourcemanager.*.get`: the strict check, if you turn it on, relies on the account
not seeing scopes it was only granted `roles/cloudasset.viewer` on.

## 4. From an export

An export needs no sign-in to draw if you drop the file into the browser. To make one:

```sh
gcloud asset export --organization=YOUR_ORG_ID --content-type=resource --output-path=gs://YOUR_BUCKET/export.json
```

(`--folder=YOUR_FOLDER_ID` or `--project=YOUR_PROJECT_ID` for the other kinds.) Making it needs
`roles/cloudasset.viewer` on the scope. To read the export from Cloud Storage inside gcportrait ("Read from
Cloud Storage" on the Connect page), you need `storage.objects.get` on the bucket
(`roles/storage.objectViewer`); it is read with your own sign-in. If you keep the export operation's JSON next
to the file as `operation.json`, gcportrait takes the export's exact read time from it.

## 5. What the backend never does

- It never stores a token, an email or an asset: it forwards your token to Google and forgets each page once
  it is sent to your browser.
- It never logs a token or an email; the gate's audit line carries the email's hash only. Your token arrives
  in `X-Gcportrait-Token` (from the app; a script may use `Authorization: Bearer` instead on a public
  instance), and neither header's value reaches a log line.
- It works the same behind Identity-Aware Proxy: IAP decides who may open the instance, your own roles (or, in
  service-account mode, the gate and the account's grant) what you may read.
- It calls only Google's Cloud Asset Inventory, Resource Manager, Cloud Storage and OAuth2 hosts on your
  behalf, so it cannot be used to reach anything else. Its own account's token comes from the platform's
  metadata server (or the credentials file above) and is never sent to the browser.

## 6. Checking a scope

Open the Permissions page (or the Connect page's "Read your environment" after sign-in), choose "Your account"
or "Service account" under **Read with**, pick the scope (and, for your own account, a quota project), and
press **Check permissions**. The answer is a headline and a checklist. Each item has a status (OK, Missing or
Unknown), one sentence, the permission, the member and the resource it is about, Google's own answer when it
could not tell, and a Copy button for each command; "Pull now" stays unavailable until the headline is
*Ready*.

**The headline.**

| Outcome | It says | What to do |
|---|---|---|
| ready | "Ready: everything gcportrait needs to read this scope is in place." | press "Pull now" |
| blocked | "Not ready yet: what is missing is listed below, with commands that grant it." | run the commands of the items marked Missing (or have someone who may grant roles run them), wait a minute, check again |
| sign-in | "Sign in again and allow gcportrait to read Cloud Asset Inventory." | sign in again and leave both Cloud scopes ticked ([section 2](#2-with-your-own-account)) |
| retry | "Google did not answer every check. Try again in a moment." | check again |

**The items, your own account.** In this order; an item after one that stopped the check is *not checked*.

| Item | OK says | Otherwise | Command shown |
|---|---|---|---|
| See the scope’s details (a warning: it never blocks) | "You can see SCOPE’s details, so the diagram shows names." | "You cannot see SCOPE’s details, so gcportrait shows ids instead of names. Reading its assets still works." | the `roles/browser` binding for you on the scope |
| A quota project for Cloud Asset Inventory | "Requests use the quota of QUOTA_PROJECT." | no project to try: "Pick a project to pay for the Cloud Asset Inventory requests: one where the Cloud Asset API is enabled and you hold serviceusage.services.use (in roles/serviceusage.serviceUsageConsumer)."; none works: "None of the projects tried can pay for the requests. Fix one of them as shown, or pick another project." | per project tried, below |
| List the scope’s assets | "You can list the assets in SCOPE." | "You cannot list assets in SCOPE, or it does not exist."; before a quota project works: "Not checked yet: Google checks the quota project first. If listing is refused once that works, this is the grant you need." | the `roles/cloudasset.viewer` binding for you on the scope |

The quota projects tried, in this order: the scope itself when it is a project, then the project you picked
(the check remembers your pick per scope). Never the instance's own project. For each, one sentence and its
fix:

| Result | It says | Command shown |
|---|---|---|
| usable | "QUOTA_PROJECT can pay for the requests." | — |
| not found | "QUOTA_PROJECT does not exist or was deleted. Pick another project." | — |
| no permission | "You may not use QUOTA_PROJECT for API quota." | `gcloud projects add-iam-policy-binding YOUR_QUOTA_PROJECT --member="user:YOUR_EMAIL" --role="roles/serviceusage.serviceUsageConsumer"` |
| API disabled | "The Cloud Asset API is not enabled in QUOTA_PROJECT. After enabling it, allow a few minutes." | `gcloud services enable cloudasset.googleapis.com --project=YOUR_QUOTA_PROJECT` |

**The items, service-account mode.** The same gate as every read as the account ([section
3](#3-through-the-instances-service-account)):

| Item | OK says | Otherwise | Command shown |
|---|---|---|---|
| You can see the scope yourself | "You can see SCOPE yourself, so the service account may read it for you." | "You cannot see SCOPE yourself, so service-account mode is refused for it." | the `roles/browser` binding for you on the scope |
| The service account cannot see the scope’s details on its own (only with the strict exposure check) | "The service account cannot read SCOPE’s details on its own, as it should be." | "The service account can read SCOPE’s details itself, for example because they are public, so service-account mode is refused for SCOPE." | — |
| The service account can list the scope’s assets | "The service account can list the assets in SCOPE." | "The service account cannot list assets in SCOPE. Grant it roles/cloudasset.viewer there." | the `roles/cloudasset.viewer` binding for the account on the scope |

**Answers any item can get.** "Sign in again and allow gcportrait to read Cloud Asset Inventory." (your token
lacks a scope); "Google did not answer in time, even after a few tries. Try again in a moment."; "This
gcportrait instance has no service-account credentials to check with." (tell the operator); and for anything
the check does not understand, Google's own answer as "Google refused the request (STATUS CODE REASON):
MESSAGE", for example a refusal by VPC Service Controls (`403 PERMISSION_DENIED SECURITY_POLICY_VIOLATED`).
CODE is Google's canonical status, or the one its HTTP status implies when the answer names none (an HTML
error page reads "404 NOT_FOUND", without a message), as a pull's error names it. The check fails closed:
what it cannot read is never OK.

Every command is filled in with the scope's command group (`gcloud organizations`,
`gcloud resource-manager folders` or `gcloud projects`), the scope's id, the quota project, and your email or
the account's, as Google reported them; an email Google did not report shows as `YOUR_EMAIL`. Nothing typed
into the page can reach a command: the scope and the project are checked against Google's id formats first.

After a grant, Google may take a minute or two to apply it; check again. "Pull now", and the timeline's reads
of other days, need a check that answered *Ready* for exactly that scope, mode and quota project.

## 7. Removing access again

- **Sign out** (the account menu at the top right) revokes gcportrait's access with Google at once. It
  withdraws the account's whole grant to the instance's OAuth client, so other tabs signed in with the same
  account end their session at their next request. You can also remove the grant on your Google Account's
  "Third-party apps and services" page.
- **Grants** you made for gcportrait are ordinary IAM bindings; remove them with `remove-iam-policy-binding`
  and the same arguments as the command that added them (section 3 shows one for a folder).
- **What gcportrait kept** is in your browser only: the Snapshots page deletes snapshots and cached timeline
  days.
