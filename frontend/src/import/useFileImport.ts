// SPDX-License-Identifier: Apache-2.0
/**
 * Shared hook for importing snapshot files dropped on a drop zone or chosen with "Choose files…".
 *
 * Used by LoadExport on the Connect page and ImportPanel on the Snapshots page. Both offer a drop
 * zone, file picker, typed-read-time check, progress reporting, cancel handling, and failure alerts.
 */
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type RefObject } from 'react';

import { CANCELLED_MESSAGE, type JobState } from '../snapshots/JobStatus';
import { formatCount, snapshotLabel } from '../snapshots/labels';
import type { ImportCandidate, Imported, ImportOptions } from '../snapshots/library';
import { useSnapshotLibrary } from '../snapshots/SnapshotLibraryProvider';
import { useImportSignal } from '../snapshots/useImportSignal';
import { SnapshotJobCancelled, SnapshotJobError } from '../snapshots/worker/client';
import { useTypedReadTime, type TypedReadTime } from './ReadTimeField';

export interface UseFileImportOptions {
  /** Whether importing is usable (e.g. browser storage available). Default: true. */
  readonly usable?: boolean | undefined;
  /** Whether an external job is running, marking this import busy. Default: false. */
  readonly busy?: boolean | undefined;
  /**
   * Title for failure state, either a fixed string or a formatter receiving the file names.
   * Default: `Nothing was imported from ${names}.`
   */
  readonly title?: string | ((names: string) => string) | undefined;
  /**
   * Optional confirm hook before saving snapshots (e.g. LargeSnapshotGuard).
   */
  readonly confirm?:
    ((signal: AbortSignal) => (candidates: readonly ImportCandidate[]) => Promise<boolean>) | undefined;
  /**
   * Called when files start to be imported (e.g. to clear caller-managed notes).
   */
  readonly onStart?: (() => void) | undefined;
  /**
   * Called when an import finishes successfully.
   * If omitted, a summary message is set on the idle state (`Imported ...`).
   */
  readonly onDone?: ((result: Imported) => void) | undefined;
  /** Optional custom ref for the choose button (focused on cancel). */
  readonly chooseButton?: RefObject<HTMLButtonElement | null> | undefined;
  /** Optional custom ref for the hidden file input. */
  readonly fileInput?: RefObject<HTMLInputElement | null> | undefined;
  /** Optional external typed read time state. Default: calls useTypedReadTime(). */
  readonly typedTime?: TypedReadTime | undefined;
}

export interface FileImport {
  readonly state: JobState;
  readonly subject: string;
  readonly warnings: readonly string[];
  readonly dropping: boolean;
  readonly busy: boolean;
  readonly usable: boolean;
  readonly typedTime: TypedReadTime;
  readonly chooseButton: RefObject<HTMLButtonElement | null>;
  readonly fileInput: RefObject<HTMLInputElement | null>;
  readonly mounted: RefObject<boolean>;
  readonly openFilePicker: () => void;
  readonly onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  readonly dropHandlers: {
    readonly onDragEnter: (event: DragEvent<HTMLElement>) => void;
    readonly onDragOver: (event: DragEvent<HTMLElement>) => void;
    readonly onDragLeave: () => void;
    readonly onDrop: (event: DragEvent<HTMLElement>) => void;
  };
  readonly start: (files: readonly File[]) => void;
  readonly cancel: () => void;
}

export function useFileImport(options: UseFileImportOptions = {}): FileImport {
  const library = useSnapshotLibrary();
  const [state, setState] = useState<JobState>({ kind: 'idle' });
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [dropping, setDropping] = useState(false);
  const [subject, setSubject] = useState('the files');
  const internalChooseButton = useRef<HTMLButtonElement>(null);
  const internalFileInput = useRef<HTMLInputElement>(null);
  const chooseButton = options.chooseButton ?? internalChooseButton;
  const fileInput = options.fileInput ?? internalFileInput;
  const mounted = useRef(true);
  const importSignal = useImportSignal();
  const defaultTypedTime = useTypedReadTime();
  const typedTime = options.typedTime ?? defaultTypedTime;

  const reading = state.kind === 'busy';
  const busy = reading || (options.busy ?? false);
  const usable = (options.usable ?? true) && library.canWork;
  const accepted = usable && !busy;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const cancel = (): void => {
    importSignal.cancel();
    chooseButton.current?.focus();
  };

  const start = (files: readonly File[]): void => {
    if (!usable || busy || files.length === 0) return;
    const names = files.map((file) => file.name).join(', ');
    const failureTitle =
      typeof options.title === 'function'
        ? options.title(names)
        : typeof options.title === 'string'
          ? options.title
          : `Nothing was imported from ${names}.`;

    options.onStart?.();
    setSubject(names);
    setWarnings([]);

    if (typedTime.problem !== null) {
      setState({
        kind: 'failed',
        title: failureTitle,
        message: typedTime.problem,
        problems: [],
      });
      return;
    }

    setState({ kind: 'busy', progress: null });
    const signal = importSignal.begin();
    const confirm = options.confirm ? options.confirm(signal) : undefined;
    const importOptions: ImportOptions = {
      signal,
      ...(confirm ? { confirm } : {}),
      ...(typedTime.readTime !== undefined ? { readTime: typedTime.readTime } : {}),
    };

    library
      .importFiles(
        files,
        (progress) => {
          if (mounted.current && !signal.aborted) setState({ kind: 'busy', progress });
        },
        importOptions,
      )
      .then(
        (result) => {
          if (!mounted.current) return;
          if (result.declined === true) {
            setState({ kind: 'idle', message: CANCELLED_MESSAGE });
            return;
          }
          setWarnings(result.warnings);
          if (options.onDone) {
            setState({ kind: 'idle' });
            options.onDone(result);
          } else {
            const what = result.records
              .map(
                (record) => `${snapshotLabel(record.meta)} (${formatCount(record.meta.assetCount)} assets)`,
              )
              .join('; ');
            setState({ kind: 'idle', message: `Imported ${what}.` });
          }
        },
        (error: unknown) => {
          if (!mounted.current) return;
          if (error instanceof SnapshotJobCancelled) {
            setState({ kind: 'idle', message: CANCELLED_MESSAGE });
            return;
          }
          setState({
            kind: 'failed',
            title: failureTitle,
            message: error instanceof Error ? error.message : String(error),
            problems: error instanceof SnapshotJobError ? error.problems : [],
          });
        },
      );
  };

  const openFilePicker = (): void => {
    if (usable && !busy) fileInput.current?.click();
  };

  const onFileInputChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = [...(event.currentTarget.files ?? [])];
    event.currentTarget.value = '';
    start(files);
  };

  const onDragOver = (event: DragEvent<HTMLElement>): void => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = accepted ? 'copy' : 'none';
    setDropping(accepted);
  };

  const onDragLeave = (): void => {
    setDropping(false);
  };

  const onDrop = (event: DragEvent<HTMLElement>): void => {
    setDropping(false);
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    start([...event.dataTransfer.files]);
  };

  return {
    state,
    subject,
    warnings,
    dropping,
    busy,
    usable,
    typedTime,
    chooseButton,
    fileInput,
    mounted,
    openFilePicker,
    onFileInputChange,
    dropHandlers: {
      onDragEnter: onDragOver,
      onDragOver,
      onDragLeave,
      onDrop,
    },
    start,
    cancel,
  };
}
