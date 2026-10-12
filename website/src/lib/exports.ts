// SPDX-License-Identifier: MIT
/**
 * The sample exports the site offers (docs/media/exports/, written by `node scripts/exports.mjs`; docs/website.md,
 * "Sample exports"): real SVG, PNG and draw.io files of the synthetic demo organisations as `pnpm render` draws them,
 * in both themes, each with a WebP preview at 480 and 960 pixels. Like every export since 2026-10-11 they carry no
 * affiliation line (ADR 0018): the site states it in its footer. The manifest (docs/media/exports/manifest.json) says
 * what each file is; Vite imports the files from docs/media/exports at build time, so each is published once under a
 * content-hashed name and the site loads nothing from elsewhere. A draw.io file is also offered through diagrams.net,
 * which opens it from its address on the site (a link to app.diagrams.net, never a resource the site loads).
 *
 * A sample whose files are missing is left out with a warning (a strict build fails), so the site still builds on a
 * fresh clone of a branch whose samples are being regenerated.
 */
import { SITE_URL } from '../site.js';
import { isStrictBuild, readRepoFile } from './repo.js';

export const EXPORT_THEMES = ['light', 'dark'] as const;
export type ExportTheme = (typeof EXPORT_THEMES)[number];
export type ExportFormat = 'png' | 'svg' | 'drawio' | 'webp';

/** diagrams.net, which opens a `.drawio` file from a public address given as `?url=`. */
export const DIAGRAMS_NET_URL = 'https://app.diagrams.net/';

/** The diagrams.net link that opens the file at `path` on the published site (`?url=` and its public address). */
export function diagramsNetLink(path: string, site: string = SITE_URL): string {
  return `${DIAGRAMS_NET_URL}?url=${encodeURIComponent(new URL(path, `${site}/`).href)}`;
}

export type ExportFileEntry = {
  readonly file: string;
  readonly sample: string;
  readonly fixture: string;
  readonly lens: string;
  readonly theme: ExportTheme;
  readonly format: ExportFormat;
  readonly width: number;
  readonly height: number;
  readonly bytes: number;
  readonly sha256: string;
  readonly detail?: string;
  readonly command: string;
};

export type ExportSampleEntry = {
  readonly id: string;
  readonly fixture: string;
  readonly lens: string;
  readonly lensTitle: string;
  readonly focus?: string;
  readonly title: string;
  readonly summary: string;
};

export type ExportsManifest = {
  readonly generator: string;
  readonly samples: readonly ExportSampleEntry[];
  readonly files: readonly ExportFileEntry[];
};

/** A file a visitor can download or open: its URL on the site, its size, and the name a download is saved under. */
export type ExportDownload = {
  readonly url: string;
  readonly bytes: number;
  /** "748 kB", "1.2 MB" */
  readonly size: string;
  readonly width: number;
  readonly height: number;
  readonly downloadName: string;
};

export type ExportPreview = {
  readonly src: string;
  readonly srcset: string;
  readonly width: number;
  readonly height: number;
};

export type ThemeExport = {
  readonly theme: ExportTheme;
  readonly png: ExportDownload;
  readonly svg: ExportDownload;
  /** The draw.io file, and the diagrams.net link that opens it from the site. */
  readonly drawio: ExportDownload & { readonly open: string };
  readonly preview: ExportPreview;
  /** The command that made the PNG, the SVG and the draw.io file. */
  readonly command: string;
};

export type SampleExport = ExportSampleEntry & {
  /** The detail level `auto` opened the view at ("all", "folders", "projects"), when the manifest says. */
  readonly detail?: string;
  readonly themes: readonly ThemeExport[];
};

const PREFIX = 'docs/media/exports/manifest.json';

function fail(message: string): never {
  throw new Error(`${PREFIX}: ${message}`);
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(`${what} is not an object`);
  return value as Record<string, unknown>;
}

function text(item: Record<string, unknown>, key: string, what: string): string {
  const value = item[key];
  if (typeof value !== 'string' || value === '') fail(`${what}.${key} is not a non-empty string`);
  return value;
}

function count(item: Record<string, unknown>, key: string, what: string): number {
  const value = item[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0)
    fail(`${what}.${key} is not a positive integer`);
  return value;
}

/** The manifest, checked: every field the site uses is there and of its type. */
export function parseExportsManifest(raw: unknown): ExportsManifest {
  const top = record(raw, 'the file');
  const samples = top.samples;
  const files = top.files;
  if (!Array.isArray(samples) || samples.length === 0) fail('samples is not a non-empty list');
  if (!Array.isArray(files) || files.length === 0) fail('files is not a non-empty list');
  return {
    generator: text(top, 'generator', 'the file'),
    samples: samples.map((value: unknown, index): ExportSampleEntry => {
      const what = `samples[${String(index)}]`;
      const item = record(value, what);
      const focus = item.focus;
      return {
        id: text(item, 'id', what),
        fixture: text(item, 'fixture', what),
        lens: text(item, 'lens', what),
        lensTitle: text(item, 'lensTitle', what),
        ...(typeof focus === 'string' && focus !== '' ? { focus } : {}),
        title: text(item, 'title', what),
        summary: text(item, 'summary', what),
      };
    }),
    files: files.map((value: unknown, index): ExportFileEntry => {
      const what = `files[${String(index)}]`;
      const item = record(value, what);
      const theme = item.theme;
      const format = item.format;
      if (theme !== 'light' && theme !== 'dark') fail(`${what}.theme is not light or dark`);
      if (format !== 'png' && format !== 'svg' && format !== 'drawio' && format !== 'webp')
        fail(`${what}.format is not png, svg, drawio or webp`);
      const detail = item.detail;
      return {
        file: text(item, 'file', what),
        sample: text(item, 'sample', what),
        fixture: text(item, 'fixture', what),
        lens: text(item, 'lens', what),
        theme,
        format,
        width: count(item, 'width', what),
        height: count(item, 'height', what),
        bytes: count(item, 'bytes', what),
        sha256: text(item, 'sha256', what),
        ...(typeof detail === 'string' && detail !== '' ? { detail } : {}),
        command: text(item, 'command', what),
      };
    }),
  };
}

/** A size as people read it: "748 kB" below a megabyte, "1.2 MB" from there (decimal units, as browsers show them). */
export function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${String(Math.max(1, Math.round(bytes / 1000)))} kB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

/**
 * The manifest's files grouped into samples, each with both themes' PNG, SVG, draw.io file and preview, in the
 * manifest's order.
 * `urlOf` gives a file's URL on the site, undefined when the build lacks it; a sample with a file missing is left out
 * and named in `missing`.
 */
export function exportSamples(
  manifest: ExportsManifest,
  urlOf: (file: string) => string | undefined,
  missing: (file: string) => void = () => undefined,
): SampleExport[] {
  const samples: SampleExport[] = [];
  for (const sample of manifest.samples) {
    const themes: ThemeExport[] = [];
    let detail: string | undefined;
    let complete = true;
    for (const theme of EXPORT_THEMES) {
      const files = manifest.files.filter((entry) => entry.sample === sample.id && entry.theme === theme);
      const download = (format: 'png' | 'svg' | 'drawio'): ExportDownload | undefined => {
        const entry = files.find((item) => item.format === format);
        if (entry === undefined) {
          missing(`${sample.id}-${theme}.${format}`);
          return undefined;
        }
        detail ??= entry.detail;
        const url = urlOf(entry.file);
        if (url === undefined) {
          missing(entry.file);
          return undefined;
        }
        return {
          url,
          bytes: entry.bytes,
          size: formatBytes(entry.bytes),
          width: entry.width,
          height: entry.height,
          downloadName: `gcportrait-demo-${entry.file}`,
        };
      };
      const png = download('png');
      const svg = download('svg');
      const drawio = download('drawio');
      const previews = files
        .filter((item) => item.format === 'webp')
        .sort((a, b) => a.width - b.width)
        .map((item) => ({ entry: item, url: urlOf(item.file) }));
      for (const preview of previews) if (preview.url === undefined) missing(preview.entry.file);
      const largest = previews.at(-1);
      if (
        png === undefined ||
        svg === undefined ||
        drawio === undefined ||
        largest?.url === undefined ||
        previews.some((p) => p.url === undefined)
      ) {
        if (previews.length === 0) missing(`${sample.id}-${theme} previews`);
        complete = false;
        continue;
      }
      themes.push({
        theme,
        png,
        svg,
        drawio: { ...drawio, open: diagramsNetLink(drawio.url) },
        preview: {
          src: largest.url,
          srcset: previews
            .map((preview) => `${preview.url ?? ''} ${String(preview.entry.width)}w`)
            .join(', '),
          width: largest.entry.width,
          height: largest.entry.height,
        },
        command: files.find((item) => item.format === 'png')?.command ?? '',
      });
    }
    if (complete) samples.push({ ...sample, ...(detail === undefined ? {} : { detail }), themes });
  }
  return samples;
}

const urls: Record<string, string> = {};
for (const [key, url] of Object.entries(
  import.meta.glob('../../../docs/media/exports/*.{png,svg,drawio,webp}', {
    eager: true,
    query: '?url',
    import: 'default',
  }),
)) {
  const at = key.lastIndexOf('/');
  if (typeof url === 'string') urls[key.slice(at + 1)] = url;
}

let cached: SampleExport[] | undefined;
const warned = new Set<string>();

function missingSample(file: string): void {
  if (warned.has(file)) return;
  warned.add(file);
  const message = `website: docs/media/exports/${file} has not been generated (run \`node scripts/exports.mjs\`)`;
  if (isStrictBuild()) throw new Error(message);
  console.warn(`${message}; its sample is left out of this build.`);
}

/** The site's sample exports, in the manifest's order; none when the manifest is missing (a strict build fails). */
export function sampleExports(): readonly SampleExport[] {
  if (cached !== undefined) return cached;
  const text = readRepoFile(PREFIX);
  if (text === undefined) {
    missingSample('manifest.json');
    cached = [];
    return cached;
  }
  cached = exportSamples(
    parseExportsManifest(JSON.parse(text) as unknown),
    (file) => urls[file],
    missingSample,
  );
  return cached;
}

/** The sample with this id, or undefined when it was left out. */
export function sampleExport(id: string): SampleExport | undefined {
  return sampleExports().find((sample) => sample.id === id);
}
