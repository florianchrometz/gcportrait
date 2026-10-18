// SPDX-License-Identifier: Apache-2.0
/**
 * The words the generator builds names from. Everything here is invented; nothing names a real organisation.
 * Lists are long enough for the XL organisation; a template that runs past the end of a list appends a serial.
 */
import { at } from '../core/rng.js';

export interface Region {
  readonly name: string;
  readonly zones: readonly string[];
  /** The region code in the older `*.a.run.app` URLs. */
  readonly runCode: string;
  /** Upper-case Cloud Storage location. */
  readonly storageLocation: string;
}

export const REGIONS: readonly Region[] = [
  {
    name: 'europe-west3',
    zones: ['europe-west3-a', 'europe-west3-b', 'europe-west3-c'],
    runCode: 'ey',
    storageLocation: 'EUROPE-WEST3',
  },
  {
    name: 'us-central1',
    zones: ['us-central1-a', 'us-central1-b', 'us-central1-c', 'us-central1-f'],
    runCode: 'uc',
    storageLocation: 'US-CENTRAL1',
  },
  {
    name: 'europe-west1',
    zones: ['europe-west1-b', 'europe-west1-c', 'europe-west1-d'],
    runCode: 'ew',
    storageLocation: 'EUROPE-WEST1',
  },
  {
    name: 'asia-northeast1',
    zones: ['asia-northeast1-a', 'asia-northeast1-b', 'asia-northeast1-c'],
    runCode: 'an',
    storageLocation: 'ASIA-NORTHEAST1',
  },
];

export const BUSINESS_UNITS: readonly string[] = [
  'retail',
  'payments',
  'logistics',
  'marketing',
  'analytics',
  'support',
  'catalog',
  'pricing',
  'search',
  'media',
  'billing',
  'partners',
  'mobile',
  'checkout',
  'loyalty',
  'inventory',
  'shipping',
  'returns',
  'reviews',
  'ads',
  'fraud',
  'warehouse',
  'finance',
  'notifications',
];

export type Env = 'prod' | 'staging' | 'dev' | 'nonprod';

export const ENV_DISPLAY: Readonly<Record<Env, string>> = {
  prod: 'Production',
  staging: 'Staging',
  dev: 'Development',
  nonprod: 'Non-production',
};

export const MICROSERVICES: readonly string[] = [
  'frontend',
  'cart',
  'catalog',
  'checkout',
  'payments',
  'shipping',
  'recommendations',
  'email',
  'currency',
  'search',
  'reviews',
  'inventory',
  'auth',
  'profile',
  'notifications',
  'pricing',
];

export const NAMESPACES: readonly string[] = [
  'shop',
  'payments',
  'platform',
  'batch',
  'edge',
  'search',
  'internal',
  'reporting',
];

export const RUN_SERVICES: readonly string[] = [
  'orders-api',
  'billing-api',
  'invoice-renderer',
  'webhooks',
  'profile-api',
  'report-builder',
  'image-resizer',
  'notifier',
];

export const FUNCTIONS: readonly string[] = ['orders-handler', 'invoice-mailer', 'audit-sink', 'thumbnailer'];

export const TOPICS: readonly string[] = [
  'orders',
  'invoices',
  'events',
  'audit',
  'notifications',
  'telemetry',
];

export const DATASETS: readonly string[] = [
  'analytics',
  'raw',
  'curated',
  'reporting',
  'ml_features',
  'finance',
];

export const TABLES: readonly string[] = [
  'orders',
  'customers',
  'sessions',
  'events',
  'invoices',
  'products',
  'inventory',
  'payments',
  'clicks',
  'refunds',
  'shipments',
  'campaigns',
];

export const MACHINE_TYPES = {
  web: 'e2-standard-2',
  api: 'e2-medium',
  vm: 'n2-standard-4',
  gke: 'e2-standard-4',
  partner: 'e2-small',
} as const;

export const DEBIAN_IMAGE =
  'https://www.googleapis.com/compute/v1/projects/debian-cloud/global/images/debian-12-bookworm-v20260910';
export const DEBIAN_FAMILY = 'projects/debian-cloud/global/images/family/debian-12';
export const DEBIAN_LICENSE =
  'https://www.googleapis.com/compute/v1/projects/debian-cloud/global/licenses/debian-12-bookworm';
export const GKE_VERSION = '1.33.4-gke.1245000';
export const GKE_NODE_IMAGE =
  'https://www.googleapis.com/compute/v1/projects/gke-node-images/global/images/gke-1334-gke1245000-cos-121-18867-199-48-c-pre';

/** `items[index]`, or the last item with the overflow appended (`search-2`), so long runs stay unique. */
export function nth(items: readonly string[], index: number): string {
  if (index < items.length) return at(items, index);
  const round = Math.floor(index / items.length) + 1;
  return `${at(items, index % items.length)}-${String(round)}`;
}
