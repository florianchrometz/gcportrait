// SPDX-License-Identifier: MIT
/**
 * The copy-ready `gcloud` commands of the permissions checklist (docs/permissions.md; skill cai-ingestion
 * §3). Every value placed into a command has been validated before: the scope and the quota project by their
 * schemas (digits, lower-case letters, `.`, `:` and `-` only), an email by {@link SAFE_EMAIL}, so no command
 * can carry shell syntax. An unknown email becomes the visible placeholder `YOUR_EMAIL`.
 */
import type { ParsedScope } from '../upstream/scope.js';

export const CLOUD_ASSET_VIEWER = 'roles/cloudasset.viewer';
export const SERVICE_USAGE_CONSUMER = 'roles/serviceusage.serviceUsageConsumer';
export const BROWSER = 'roles/browser';
export const LIST_PERMISSION = 'cloudasset.assets.listResource';
export const QUOTA_PERMISSION = 'serviceusage.services.use';

/** The placeholder for the caller's email when Google does not say it (a token without the email scope). */
export const EMAIL_PLACEHOLDER = 'YOUR_EMAIL';

/** An email that is safe inside a double-quoted shell word: no quotes, no `$`, no backquote, no space. */
const SAFE_EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,63}$/;

const SERVICE_ACCOUNT_DOMAIN = '.gserviceaccount.com';

/**
 * An IAM member for an email: `serviceAccount:` for a service account's address, `user:` otherwise. Null when
 * the email is missing or not safe to put into a command.
 */
export function memberFor(email: string | undefined): string | null {
  if (email === undefined || !SAFE_EMAIL.test(email)) return null;
  return email.toLowerCase().endsWith(SERVICE_ACCOUNT_DOMAIN) ? `serviceAccount:${email}` : `user:${email}`;
}

/** The caller's member, or the `user:YOUR_EMAIL` placeholder. */
export function callerMember(member: string | null): string {
  return member ?? `user:${EMAIL_PLACEHOLDER}`;
}

/** `gcloud … add-iam-policy-binding` on the scope, in the command group of its kind. */
export function scopeBinding(scope: ParsedScope, member: string, role: string): string {
  const group =
    scope.kind === 'organization'
      ? 'gcloud organizations'
      : scope.kind === 'folder'
        ? 'gcloud resource-manager folders'
        : 'gcloud projects';
  return `${group} add-iam-policy-binding ${scope.id} --member="${member}" --role="${role}"`;
}

/** Enables the Cloud Asset API in a quota project. */
export function enableCloudAsset(project: string): string {
  return `gcloud services enable cloudasset.googleapis.com --project=${project}`;
}

/** Lets a member use a project for API quota. */
export function quotaBinding(project: string, member: string): string {
  return `gcloud projects add-iam-policy-binding ${project} --member="${member}" --role="${SERVICE_USAGE_CONSUMER}"`;
}
