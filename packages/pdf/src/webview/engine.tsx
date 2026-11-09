import type {
  FailedDocumentInfo,
  Identity,
  OpenInput,
  ViewerPageSettings,
} from "@embedpdf/core";
import { DocumentGate, EmbedPDF } from "@embedpdf/react/runtime";
import React, { useCallback, useEffect, useState } from "react";
import type { ViewerEngine } from "./browser-render-environment";
import {
  EngineHostDisposedError,
  type EngineHost,
  type EngineMode,
} from "./engine-host";
import { postToHost } from "./host";
import { DOCUMENT_ID, viewerPlugins } from "./plugins";
import { Viewer } from "./viewer";

/** A worker that has not opened the PDF within this time is given up. */
const WORKER_TIMEOUT_MS = 15_000;

/** Who the author of a mark made in the viewer is. */
const AUTHOR: Identity = { displayName: "Lumiere" };

/**
 * What the reader may do in any PDF: everything. EmbedPDF 3 by default holds a
 * file to its own permission flags as Acrobat does, so a PDF that forbids
 * copying or annotating would refuse selecting its text, handing it to an
 * agent and marking it up. The viewer has always read and marked every file
 * its user opens, whatever its flags say; this keeps that.
 */
const READER_SCOPE: readonly string[] = ["*"];

/**
 * How pages look before their picture arrives, and around it: white paper
 * (the theme's `--paper`, styles/base.css) on a soft shadow.
 */
const PAGE_LOOK: Partial<ViewerPageSettings> = {
  background: "var(--paper)",
  shadow: "0 1px 6px #0006",
};

/**
 * The PDF's bytes, held until the engine has opened them. The engine copies
 * them, so the page's own copy goes as soon as the document is open; until
 * then a worker that failed leaves the main-thread engine to open them again.
 */
export interface PdfBytes {
  current: ArrayBuffer | undefined;
}

/**
 * Start PDFium and show the PDF.
 *
 * PDFium normally runs in a web worker so rendering never blocks scrolling.
 * If the worker cannot start (a blocked blob URL, a failed WASM fetch, a
 * crash, or silence), the engine restarts on the main thread instead. The
 * engines belong to the host (engine-host.ts, owned by main.tsx), which keeps
 * the engine across reloads; this component only asks for them.
 */
export function PdfEngine({
  host,
  bytes,
}: {
  host: EngineHost<ViewerEngine>;
  bytes: PdfBytes;
}): React.JSX.Element {
  const [mode, setMode] = useState<EngineMode>("worker");
  const useMainThread = useCallback(() => setMode("main-thread"), []);
  return (
    <EngineSession
      key={mode}
      host={host}
      mode={mode}
      bytes={bytes}
      onWorkerFailure={useMainThread}
    />
  );
}

/** The host's engine for `mode`, or the error that kept it from starting. */
function useHostEngine(
  host: EngineHost<ViewerEngine>,
  mode: EngineMode,
): { engine?: ViewerEngine; error?: unknown } {
  const [state, setState] = useState<{
    engine?: ViewerEngine;
    error?: unknown;
  }>({});
  useEffect(() => {
    let active = true;
    host.engine(mode).then(
      (engine) => {
        performance.mark("pdf:engine");
        if (active) {
          setState({ engine });
        }
      },
      (error: unknown) => {
        if (active && !(error instanceof EngineHostDisposedError)) {
          setState({ error });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [host, mode]);
  return state;
}

function EngineSession({
  host,
  mode,
  bytes,
  onWorkerFailure,
}: {
  host: EngineHost<ViewerEngine>;
  mode: EngineMode;
  bytes: PdfBytes;
  onWorkerFailure: () => void;
}): React.JSX.Element {
  const worker = mode === "worker";
  const { engine, error } = useHostEngine(host, mode);
  // EmbedPDF reads both only when it mounts: they must not change identity.
  const [plugins] = useState(viewerPlugins);
  const [documents] = useState(() => [
    { source: () => bytesToOpen(bytes), name: "document.pdf" },
  ]);
  const [opened, setOpened] = useState(false);
  useEngineFailure({ error, worker, opened, onWorkerFailure });
  if (!engine) {
    return <Status text="Starting the PDF engine…" />;
  }
  return (
    <EmbedPDF
      engine={engine}
      plugins={plugins}
      initialDocuments={documents}
      identity={AUTHOR}
      scope={READER_SCOPE}
      page={PAGE_LOOK}
      renderError={(failure) => <Failed error={failure} />}
    >
      <DocumentGate
        fallback={<Status text="Opening the PDF…" />}
        locked={() => (
          <Status text="This PDF is password-protected, which the viewer cannot open." />
        )}
        error={(document) => (
          <OpenFailed
            document={document}
            worker={worker}
            onWorkerFailure={onWorkerFailure}
          />
        )}
      >
        <OnMount
          callback={() => {
            performance.mark("pdf:opened");
            bytes.current = undefined;
            setOpened(true);
          }}
        >
          <Viewer />
        </OnMount>
      </DocumentGate>
    </EmbedPDF>
  );
}

/** What `initialDocuments` opens: the PDF's bytes, under the viewer's one id. */
function bytesToOpen(bytes: PdfBytes): OpenInput {
  if (!bytes.current) {
    throw new Error("The PDF's bytes were let go once it was open");
  }
  // A Uint8Array is copied into the engine; an ArrayBuffer would be moved,
  // leaving nothing for a main-thread engine to open if the worker fails.
  return {
    kind: "bytes",
    id: DOCUMENT_ID,
    bytes: new Uint8Array(bytes.current),
  };
}

/**
 * A worker engine that fails, or never opens the PDF, gives way to one on
 * the main thread; a failing main-thread engine is reported to the host.
 */
function useEngineFailure({
  error,
  worker,
  opened,
  onWorkerFailure,
}: {
  error: unknown;
  worker: boolean;
  opened: boolean;
  onWorkerFailure: () => void;
}): void {
  useEffect(() => {
    if (error) {
      reportEngineFailure(error, worker, onWorkerFailure);
    }
  }, [error, onWorkerFailure, worker]);

  // Treat a worker that never answers like one that failed.
  useEffect(() => {
    if (!worker || opened) {
      return;
    }
    const timer = window.setTimeout(onWorkerFailure, WORKER_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [onWorkerFailure, opened, worker]);
}

function reportEngineFailure(
  error: unknown,
  worker: boolean,
  onWorkerFailure: () => void,
): void {
  if (worker) {
    console.warn(
      "The PDF engine could not start in a worker; using the main thread.",
      error,
    );
    onWorkerFailure();
  } else {
    postToHost({
      type: "error",
      message: `The PDF engine failed: ${String(error)}`,
    });
  }
}

/**
 * The PDF did not open. Most often it is the file (damaged), which the
 * engine says as `invalid-input`; any other reason is the engine's own (a
 * worker that failed to boot rejects every document with `operation-failed`),
 * and a worker gives way to the main thread for it.
 */
function OpenFailed({
  document,
  worker,
  onWorkerFailure,
}: {
  document: FailedDocumentInfo;
  worker: boolean;
  onWorkerFailure: () => void;
}): React.JSX.Element {
  const { code, message } = document.error;
  useEffect(() => {
    if (code === "operation-failed") {
      reportEngineFailure(message, worker, onWorkerFailure);
    }
  }, [code, message, onWorkerFailure, worker]);
  return <Status text="This PDF could not be opened." />;
}

/** The viewer itself failed to start (a plugin could not be set up). */
function Failed({ error }: { error: unknown }): React.JSX.Element {
  useEffect(() => {
    postToHost({
      type: "error",
      message: `The PDF viewer failed to start: ${String(error)}`,
    });
  }, [error]);
  return <Status text="This PDF could not be opened." />;
}

function OnMount({
  callback,
  children,
}: {
  callback: () => void;
  children: React.ReactNode;
}): React.ReactNode {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  useEffect(callback, []);
  return children;
}

export function Status({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="status" role="status">
      {text}
    </div>
  );
}
