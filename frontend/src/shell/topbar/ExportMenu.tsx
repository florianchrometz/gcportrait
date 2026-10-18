// SPDX-License-Identifier: Apache-2.0
/**
 * The Export menu in the top bar (docs/export.md): the app's MenuButton and Menu (ui/), whose menu holds the options
 * (area, theme, PNG resolution, embedded fonts) as radio and checkbox items in labelled groups and the four actions
 * (download SVG, download PNG, download the draw.io file, copy PNG). The area and the theme apply to all three files;
 * the draw.io file is translated by a module loaded on its first use. Options keep the menu open; an action closes
 * it, returns focus to the button and reports its outcome in a status line (a live region). Its open state is the
 * store's one popup at a time (`usePopover`). Inert (`aria-disabled`, still focusable) while no diagram is drawn; the
 * status line (named "Export status") exists only while there is a diagram to export.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';

import { useDiagramSession } from '../../diagram/session';
import type { DiagramTheme } from '../../diagram/theme/tokens';
import { canCopyImages, copyPng, saveFile } from '../../export/deliver';
import {
  ExportError,
  exportDrawioFile,
  exportPngFile,
  exportSvgFile,
  type ExportArea,
  type ExportSettings,
} from '../../export/exportDiagram';
import { sessionFontFaceCss } from '../../export/fonts';
import { rasterizeSvg, scaleLabel, type PngGeometry, type PngScale } from '../../export/raster';
import { usePopover } from '../../state';
import { useTheme } from '../../theme/useTheme';
import type { MenuItem } from '../../ui/Menu';
import { MenuButton } from '../../ui/MenuButton';
import controls from '../../ui/controls.module.css';
import styles from './ExportMenu.module.css';

/** What the menu does with the outside world; tests replace parts of it. */
export interface ExportServices {
  /** The embedded fonts' `@font-face` CSS (always for PNG; for SVG with "embed fonts"). */
  readonly fontFaces: () => Promise<string>;
  readonly rasterize: typeof rasterizeSvg;
  readonly save: (blob: Blob, fileName: string) => void;
  readonly canCopy: () => boolean;
  readonly copy: (png: Promise<Blob>) => Promise<void>;
  /** The draw.io file (its translator loaded on first use). */
  readonly drawio: typeof exportDrawioFile;
}

const BROWSER_SERVICES: ExportServices = {
  fontFaces: sessionFontFaceCss,
  rasterize: rasterizeSvg,
  drawio: exportDrawioFile,
  save: (blob, fileName) => {
    saveFile(blob, fileName);
  },
  canCopy: () => canCopyImages(),
  copy: (png) => copyPng(png),
};

/** How long an outcome stays on screen. */
const STATUS_MS = 10_000;

export const NO_DIAGRAM_HINT = 'Draw a diagram to export it';
/** The status line's name: pages have status lines of their own. */
export const STATUS_NAME = 'Export status';
export const COPY_UNSUPPORTED = 'This browser cannot copy images to the clipboard. Use Download PNG instead.';
/** The draw.io action's name: the format and its file extension, as diagrams.net and draw.io call it. */
export const DRAWIO_ACTION = 'Download draw.io (.drawio)';

function pixels(geometry: PngGeometry): string {
  const reduced = geometry.reduced
    ? `, at ${scaleLabel(geometry.scale)}: the browser cannot draw this diagram larger`
    : '';
  return `${String(geometry.width)} × ${String(geometry.height)} px${reduced}`;
}

function failure(error: unknown, action: string): string {
  if (error instanceof ExportError) return error.message;
  if (error instanceof DOMException && error.name === 'NotAllowedError')
    return 'The browser did not allow access to the clipboard.';
  const reason = error instanceof Error ? error.message : String(error);
  return `${action} failed: ${reason}`;
}

export function ExportMenu({
  services,
  version,
}: {
  readonly services?: Partial<ExportServices>;
  /** The instance's version, written in a draw.io file's `agent` after the wordmark; none in the demo. */
  readonly version?: string | undefined;
}): ReactElement {
  const { exportSource: source } = useDiagramSession();
  const { resolved } = useTheme();
  const io = useMemo<ExportServices>(() => ({ ...BROWSER_SERVICES, ...services }), [services]);
  const [open, setPopover] = usePopover('export');
  const [area, setArea] = useState<ExportArea>('whole');
  const [themeChoice, setThemeChoice] = useState<DiagramTheme | null>(null);
  const [scale, setScale] = useState<PngScale>(2);
  const [embedFonts, setEmbedFonts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const theme = themeChoice ?? resolved;
  const available = source !== null;

  // The status line clears itself after a while, unless an export is still running.
  useEffect(() => {
    if (status === '' || busy) return undefined;
    const timer = setTimeout(() => {
      setStatus('');
    }, STATUS_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [status, busy]);

  // Opening the menu clears the last outcome, unless an export is still running.
  const setOpen = (next: boolean): void => {
    if (next) setStatus((current) => (busy ? current : ''));
    setPopover(next);
  };

  const settings: ExportSettings = { area, theme };

  const runExport = (action: 'svg' | 'png' | 'drawio' | 'copy'): void => {
    if (source === null || busy) return;
    if (action === 'copy' && !io.canCopy()) {
      setStatus(COPY_UNSUPPORTED);
      return;
    }
    setBusy(true);
    if (action === 'drawio') {
      setStatus('Writing the draw.io file…');
      io.drawio(source, settings, version)
        .then((file) => {
          io.save(file.blob, file.fileName);
          setStatus(`Saved ${file.fileName}.`);
        })
        .catch((error: unknown) => {
          setStatus(failure(error, 'The draw.io export'));
        })
        .finally(() => {
          setBusy(false);
        });
      return;
    }
    if (action === 'svg') {
      setStatus('Writing the SVG…');
      const fonts = embedFonts ? io.fontFaces() : Promise.resolve(undefined);
      fonts
        .then((css) => {
          const file = exportSvgFile(source, settings, css);
          io.save(file.blob, file.fileName);
          setStatus(`Saved ${file.fileName}.`);
        })
        .catch((error: unknown) => {
          setStatus(failure(error, 'The SVG export'));
        })
        .finally(() => {
          setBusy(false);
        });
      return;
    }
    setStatus('Drawing the PNG…');
    const png = exportPngFile(source, { ...settings, scale }, io.fontFaces(), io.rasterize);
    const blob = png.then((file) => file.blob);
    // A failure is reported through `delivered`; a clipboard that refuses before the PNG is drawn must not
    // leave the PNG's own failure unhandled.
    blob.catch(() => undefined);
    const delivered =
      action === 'png'
        ? png.then((file) => {
            io.save(file.blob, file.fileName);
            return `Saved ${file.fileName} (${pixels(file.geometry)}).`;
          })
        : io
            .copy(blob)
            .then(() => png)
            .then((file) => `Copied the PNG to the clipboard (${pixels(file.geometry)}).`);
    delivered
      .then(setStatus, (error: unknown) => {
        setStatus(failure(error, action === 'png' ? 'The PNG export' : 'Copying the PNG'));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const option = (
    group: string,
    id: string,
    label: string,
    checked: boolean,
    onSelect: () => void,
    kind: 'radio' | 'checkbox' = 'radio',
  ): MenuItem => ({ id, label, kind, checked, group, keepOpen: true, onSelect });
  const action = (id: string, label: string, run: 'svg' | 'png' | 'drawio' | 'copy'): MenuItem => ({
    id,
    label,
    disabled: busy,
    onSelect: () => {
      runExport(run);
    },
  });
  const items: readonly MenuItem[] = [
    option('Area', 'whole', 'Whole diagram', area === 'whole', () => {
      setArea('whole');
    }),
    option('Area', 'viewport', 'Current viewport', area === 'viewport', () => {
      setArea('viewport');
    }),
    ...(['light', 'dark'] as const).map((value) =>
      option('Theme', value, value === 'light' ? 'Light' : 'Dark', theme === value, () => {
        setThemeChoice(value);
      }),
    ),
    ...([2, 3] as const).map((value) =>
      option('PNG resolution', `scale-${String(value)}`, scaleLabel(value), scale === value, () => {
        setScale(value);
      }),
    ),
    option(
      'SVG file',
      'embed-fonts',
      'Embed fonts',
      embedFonts,
      () => {
        setEmbedFonts((value) => !value);
      },
      'checkbox',
    ),
    action('svg', 'Download SVG', 'svg'),
    action('png', 'Download PNG', 'png'),
    action('drawio', DRAWIO_ACTION, 'drawio'),
    action('copy', 'Copy PNG', 'copy'),
  ];

  return (
    <div className={styles.anchor}>
      <MenuButton
        label="Export"
        items={items}
        align="end"
        className={controls.primary}
        disabled={available ? false : NO_DIAGRAM_HINT}
        open={open}
        onOpenChange={setOpen}
      />
      {available ? (
        <p role="status" aria-label={STATUS_NAME} className={styles.status}>
          {status}
        </p>
      ) : null}
    </div>
  );
}
