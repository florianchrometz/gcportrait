// SPDX-License-Identifier: MIT
/**
 * The Export menu in the top bar (docs/export.md): a WAI-ARIA menu button whose menu holds the options
 * (area, theme, PNG resolution, embedded fonts) as radio and checkbox items and the four actions (download SVG,
 * download PNG, download the draw.io file, copy PNG). The area and the theme apply to all three files; the draw.io
 * file is translated by a module loaded on its first use. Options keep the menu open; an action closes it,
 * returns focus to the button and reports its outcome in a status line (a live region). Keyboard: Enter, Space or ↓
 * opens on the first item, ↑ on the last; ↑ ↓ Home End move; Escape closes; Tab leaves. Inert (`aria-disabled`,
 * still focusable) while no diagram is drawn; the status line (named "Export status") exists only while there is a
 * diagram to export.
 */
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';

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
import { useTheme } from '../../theme/useTheme';
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

type Entry =
  | {
      readonly kind: 'radio' | 'checkbox';
      readonly key: string;
      readonly label: string;
      readonly checked: boolean;
      readonly select: () => void;
    }
  | { readonly kind: 'action'; readonly key: string; readonly label: string; readonly run: () => void };

interface Section {
  readonly key: string;
  /** The group's visible caption and accessible name; the actions have none. */
  readonly caption?: string;
  readonly entries: readonly Entry[];
}

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
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [area, setArea] = useState<ExportArea>('whole');
  const [themeChoice, setThemeChoice] = useState<DiagramTheme | null>(null);
  const [scale, setScale] = useState<PngScale>(2);
  const [embedFonts, setEmbedFonts] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const anchorRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const theme = themeChoice ?? resolved;
  const available = source !== null;

  const close = useCallback((refocus: boolean): void => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  }, []);

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

  // A pointer pressed anywhere outside closes the menu.
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && anchorRef.current?.contains(event.target) !== true) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, close]);

  // The diagram went away (another page, a new view loading): nothing to export any more.
  useEffect(() => {
    if (!available) setOpen(false);
  }, [available]);

  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [open, active]);

  const settings: ExportSettings = { area, theme };

  const runExport = (action: 'svg' | 'png' | 'drawio' | 'copy'): void => {
    if (source === null || busy) return;
    close(true);
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

  const radio = (key: string, label: string, checked: boolean, select: () => void): Entry => ({
    kind: 'radio',
    key,
    label,
    checked,
    select,
  });
  const sections: readonly Section[] = [
    {
      key: 'area',
      caption: 'Area',
      entries: [
        radio('whole', 'Whole diagram', area === 'whole', () => {
          setArea('whole');
        }),
        radio('viewport', 'Current viewport', area === 'viewport', () => {
          setArea('viewport');
        }),
      ],
    },
    {
      key: 'theme',
      caption: 'Theme',
      entries: (['light', 'dark'] as const).map((value) =>
        radio(value, value === 'light' ? 'Light' : 'Dark', theme === value, () => {
          setThemeChoice(value);
        }),
      ),
    },
    {
      key: 'scale',
      caption: 'PNG resolution',
      entries: ([2, 3] as const).map((value) =>
        radio(`scale-${String(value)}`, scaleLabel(value), scale === value, () => {
          setScale(value);
        }),
      ),
    },
    {
      key: 'fonts',
      caption: 'SVG file',
      entries: [
        {
          kind: 'checkbox',
          key: 'embed-fonts',
          label: 'Embed fonts',
          checked: embedFonts,
          select: () => {
            setEmbedFonts((value) => !value);
          },
        },
      ],
    },
    {
      key: 'actions',
      entries: [
        {
          kind: 'action',
          key: 'svg',
          label: 'Download SVG',
          run: () => {
            runExport('svg');
          },
        },
        {
          kind: 'action',
          key: 'png',
          label: 'Download PNG',
          run: () => {
            runExport('png');
          },
        },
        {
          kind: 'action',
          key: 'drawio',
          label: DRAWIO_ACTION,
          run: () => {
            runExport('drawio');
          },
        },
        {
          kind: 'action',
          key: 'copy',
          label: 'Copy PNG',
          run: () => {
            runExport('copy');
          },
        },
      ],
    },
  ];
  const entries = sections.flatMap((section) => section.entries);
  const count = entries.length;

  const openAt = (index: number): void => {
    if (!available) return;
    setStatus((current) => (busy ? current : ''));
    setActive((index + count) % count);
    setOpen(true);
  };

  const onButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      openAt(0);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      openAt(count - 1);
    }
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const moves: Record<string, () => number> = {
      ArrowDown: () => (active + 1) % count,
      ArrowUp: () => (active - 1 + count) % count,
      Home: () => 0,
      End: () => count - 1,
    };
    const move = moves[event.key];
    if (move !== undefined) {
      event.preventDefault();
      setActive(move());
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
    } else if (event.key === 'Tab') {
      close(false);
    }
  };

  let index = -1;
  const item = (entry: Entry): ReactElement => {
    index += 1;
    const at = index;
    const common = {
      ref: (element: HTMLButtonElement | null) => {
        itemRefs.current[at] = element;
      },
      type: 'button' as const,
      className: styles.item,
      tabIndex: at === active ? 0 : -1,
      onFocus: () => {
        setActive(at);
      },
    };
    if (entry.kind === 'action') {
      return (
        <button
          key={entry.key}
          {...common}
          role="menuitem"
          aria-disabled={busy ? true : undefined}
          onClick={entry.run}
        >
          {entry.label}
        </button>
      );
    }
    return (
      <button
        key={entry.key}
        {...common}
        role={entry.kind === 'radio' ? 'menuitemradio' : 'menuitemcheckbox'}
        aria-checked={entry.checked}
        onClick={entry.select}
      >
        {entry.label}
      </button>
    );
  };

  return (
    <div ref={anchorRef} className={styles.anchor}>
      <button
        ref={buttonRef}
        type="button"
        className={styles.control}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-disabled={available ? undefined : true}
        title={available ? undefined : NO_DIAGRAM_HINT}
        onClick={() => {
          if (open) close(false);
          else openAt(0);
        }}
        onKeyDown={onButtonKeyDown}
      >
        Export
        <span className={styles.caret} aria-hidden="true">
          ▾
        </span>
      </button>
      {open ? (
        <div id={menuId} role="menu" aria-label="Export" className={styles.menu} onKeyDown={onMenuKeyDown}>
          {sections.map((section, sectionIndex) => {
            const separator =
              sectionIndex === 0 ? null : <div role="separator" className={styles.separator} />;
            if (section.caption === undefined) {
              return (
                <Fragment key={section.key}>
                  {separator}
                  {section.entries.map(item)}
                </Fragment>
              );
            }
            const captionId = `${menuId}-${section.key}`;
            return (
              <Fragment key={section.key}>
                {separator}
                <div role="group" aria-labelledby={captionId} className={styles.group}>
                  <div id={captionId} className={styles.caption}>
                    {section.caption}
                  </div>
                  {section.entries.map(item)}
                </div>
              </Fragment>
            );
          })}
        </div>
      ) : null}
      {available ? (
        <p role="status" aria-label={STATUS_NAME} className={styles.status}>
          {status}
        </p>
      ) : null}
    </div>
  );
}
