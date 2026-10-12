// SPDX-License-Identifier: MIT
/**
 * The website's page views, in the visitor's browser (docs/website.md, "Analytics"; the rules and the parts without a
 * DOM are in src/lib/analytics.ts). src/layouts/Base.astro runs it on every page of the site, only in a build with
 * analytics on: the demo at /demo/ is the app's own build and never has it.
 *
 * Nothing happens unless the build has analytics on, the page is on the site's own host and the browser does not ask
 * not to be tracked (Do Not Track, Global Privacy Control). Then, after the `load` event, when the browser is idle
 * (requestIdleCallback; where there is none, a short timeout), it loads TelemetryDeck's SDK (@telemetrydeck/sdk, a
 * file of the site's own build, fetched only then) and sends one `pageView` signal with the page's path to
 * TelemetryDeck's ingestion address (TELEMETRYDECK_TARGET); from then on, a click on a link to the demo or to the
 * repository sends `Outbound.demo` or `Outbound.repository` with the path. It never delays the page (it starts after
 * the page has loaded and waits for nothing) and never throws: a failure (the SDK not loading, no network, TelemetryDeck
 * not answering, storage blocked) sends nothing more and is not logged.
 */
import { TELEMETRYDECK_APP_ID, TELEMETRYDECK_TARGET } from '../site.js';
import {
  SIGNALS,
  isSiteHost,
  outboundSignal,
  pagePath,
  randomId,
  sessionIdentity,
  trackingRefused,
  type SessionStore,
  type SignalType,
  type TrackingPreferences,
} from './analytics.js';

/** What the page needs of TelemetryDeck's SDK: an instance per page, and its signal. */
export type Sender = {
  signal(type: string, payload?: Record<string, string>): Promise<unknown>;
};
export type SenderOptions = {
  readonly appID: string;
  readonly clientUser: string;
  readonly sessionID: string;
  readonly target: string;
};
export type SenderFactory = (options: SenderOptions) => Sender;

/** The browser, as the page module uses it (the tests give their own). */
export type AnalyticsContext = {
  /** Whether the build has analytics on (`__WEBSITE_ANALYTICS__`). */
  readonly enabled: boolean;
  /** The page's address. */
  readonly href: string;
  /**
   * The path the page declares for itself (the `gcportrait-page` meta the layout writes): what the page view
   * reports, so the 404 page reports `/404.html` and never the address a visitor typed or a broken link carried.
   */
  readonly declaredPath: () => string | undefined;
  readonly hostname: string;
  readonly preferences: TrackingPreferences;
  /** The tab's sessionStorage (it may throw, or be missing). */
  readonly storage: () => SessionStore | undefined;
  /** crypto.getRandomValues. */
  readonly fillRandom: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array;
  /** Runs `task` once the page has loaded and the browser is idle. */
  readonly whenIdle: (task: () => void) => void;
  /** Calls `listener` with the address of each link the visitor follows. */
  readonly onFollow: (listener: (href: string) => void) => void;
  /** The address of the repository: the header's link to it, if the page has one. */
  readonly repository: () => string | undefined;
  /** Loads the SDK (its own file of the build) and makes its instance. */
  readonly loadSender: () => Promise<SenderFactory>;
};

/** The browser's own context. */
function browserContext(): AnalyticsContext {
  const nav = navigator as Navigator & { msDoNotTrack?: unknown; globalPrivacyControl?: unknown };
  return {
    enabled: typeof __WEBSITE_ANALYTICS__ === 'boolean' && __WEBSITE_ANALYTICS__,
    href: location.href,
    declaredPath: () =>
      document.querySelector<HTMLMetaElement>('meta[name="gcportrait-page"]')?.content || undefined,
    hostname: location.hostname,
    preferences: {
      doNotTrack: nav.doNotTrack,
      msDoNotTrack: nav.msDoNotTrack,
      windowDoNotTrack: (window as Window & { doNotTrack?: unknown }).doNotTrack,
      globalPrivacyControl: nav.globalPrivacyControl,
    },
    storage: () => window.sessionStorage,
    fillRandom: (bytes) => crypto.getRandomValues(bytes),
    whenIdle: (task) => {
      const idle = (): void => {
        if ('requestIdleCallback' in window) window.requestIdleCallback(task, { timeout: 2000 });
        else setTimeout(task, 200);
      };
      if (document.readyState === 'complete') idle();
      else window.addEventListener('load', idle, { once: true });
    },
    onFollow: (listener) => {
      const follow = (event: MouseEvent): void => {
        // A click, or a middle click (a new tab); a link inside another element counts as the link.
        if (event.type === 'auxclick' && event.button !== 1) return;
        const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
        if (link instanceof HTMLAnchorElement) listener(link.href);
      };
      document.addEventListener('click', follow, { capture: true, passive: true });
      document.addEventListener('auxclick', follow, { capture: true, passive: true });
    },
    repository: () => document.querySelector<HTMLAnchorElement>('a.header-github[href]')?.href,
    loadSender: async () => {
      const { default: TelemetryDeck } = await import('@telemetrydeck/sdk');
      return (options) => new TelemetryDeck(options);
    },
  };
}

/** Whether this page may send at all: analytics on, the site's own host, no Do Not Track and no GPC. */
export function maySend(context: Pick<AnalyticsContext, 'enabled' | 'hostname' | 'preferences'>): boolean {
  return context.enabled && isSiteHost(context.hostname) && !trackingRefused(context.preferences);
}

/**
 * Starts the page's analytics (see the module comment). Returns a promise that settles once the page view has been
 * sent or given up (for the tests; the page does not wait for it). Never rejects, never throws.
 */
export function startAnalytics(context?: AnalyticsContext): Promise<void> {
  try {
    const page = context ?? browserContext();
    if (!maySend(page)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      try {
        page.whenIdle(() => {
          void send(page).finally(resolve);
        });
      } catch {
        resolve();
      }
    });
  } catch {
    return Promise.resolve();
  }
}

/** Loads the SDK, sends the page view, and from then on the followed links to the demo and the repository. */
async function send(page: AnalyticsContext): Promise<void> {
  try {
    const identity = sessionIdentity(page.storage, () => randomId(page.fillRandom));
    const sender = (await page.loadSender())({
      appID: TELEMETRYDECK_APP_ID,
      clientUser: identity.user,
      sessionID: identity.session,
      target: TELEMETRYDECK_TARGET,
    });
    const path = page.declaredPath() ?? pagePath(page.href);
    const signal = (type: SignalType): Promise<void> => {
      try {
        return sender.signal(type, { path }).then(
          () => undefined,
          () => undefined,
        );
      } catch {
        return Promise.resolve();
      }
    };
    const repository = page.repository();
    page.onFollow((href) => {
      const type = outboundSignal(href, page.href, repository);
      if (type !== undefined) void signal(type);
    });
    await signal(SIGNALS.pageView);
  } catch {
    // The SDK did not load, or the browser lacks what it needs: nothing is sent.
  }
}
