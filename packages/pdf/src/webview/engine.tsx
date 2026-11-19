import type {
  FailedDocumentInfo,
  Identity,
  OpenInput,
  ViewerPageSettings,
} from "@embedpdf/core";
import { DocumentGate, EmbedPDF } from "@embedpdf/react/runtime";
import React, { useCallback, useEffect, useState } from "react";
import type { PaneSize } from "../shared/page-picture-width";
import type { ViewerEngine } from "./browser-render-environment";
import {
  EngineHostDisposedError,
  type EngineHost,
  type EngineMode,
} from "./engine-host";
import {
  isEngineFailure,
  reportEngineFailure,
  useEngineFailure,
} from "./engine-failure";
import { postToHost } from "./host";
import { PasswordPrompt } from "./password-prompt";
import { DOCUMENT_ID, viewerPlugins } from "./plugins";
import { Viewer } from "./viewer";

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
 * crash, or silence), the engine restarts on the main thread instead; a
 * PDF that is locked or damaged is the file's answer, not the worker's
 * failure, and is shown as such (`engine-failure.ts`). The
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

/** The pane this viewer opens in, for the pictures it will draw. */
function currentPane(): PaneSize {
  return {
    cssWidth: window.innerWidth,
    pixelRatio: window.devicePixelRatio,
  };
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
  const [plugins] = useState(() => viewerPlugins(currentPane()));
  const [documents] = useState(() => [
    { source: () => bytesToOpen(bytes), name: "document.pdf" },
  ]);
  // The engine opened the PDF, or said why it cannot: the worker works.
  const [answered, setAnswered] = useState(false);
  const markAnswered = useCallback(() => setAnswered(true), []);
  useEngineFailure({
    error,
    worker,
    answered,
    onWorkerFailure,
    report: reportToHost,
  });
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
      <OpenedDocument
        worker={worker}
        onWorkerFailure={onWorkerFailure}
        onAnswer={markAnswered}
        onOpened={() => {
          performance.mark("pdf:opened");
          bytes.current = undefined;
        }}
      />
    </EmbedPDF>
  );
}

/**
 * The viewer once the PDF is open; until then, what the engine said of it:
 * a password to ask for, or why it could not be opened.
 */
function OpenedDocument({
  worker,
  onWorkerFailure,
  onAnswer,
  onOpened,
}: {
  worker: boolean;
  onWorkerFailure: () => void;
  /** The engine answered for the PDF: it opened, is locked, or is damaged. */
  onAnswer: () => void;
  onOpened: () => void;
}): React.JSX.Element {
  return (
    <DocumentGate
      fallback={<Status text="Opening the PDF…" />}
      locked={(document) => (
        <OnMount callback={onAnswer}>
          <PasswordPrompt document={document} />
        </OnMount>
      )}
      error={(document) => (
        <OpenFailed
          document={document}
          worker={worker}
          onWorkerFailure={onWorkerFailure}
          onFileFailure={onAnswer}
        />
      )}
    >
      <OnMount
        callback={() => {
          onOpened();
          onAnswer();
        }}
      >
        <Viewer />
      </OnMount>
    </DocumentGate>
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

function reportToHost(message: string): void {
  postToHost({ type: "error", message });
}

/**
 * The PDF did not open. When the engine failed (`isEngineFailure`), a worker
 * gives way to the main thread. Otherwise it is the file (damaged, or not a
 * PDF): the engine answered, and a main-thread engine would only say the
 * same after starting PDFium again.
 */
function OpenFailed({
  document,
  worker,
  onWorkerFailure,
  onFileFailure,
}: {
  document: FailedDocumentInfo;
  worker: boolean;
  onWorkerFailure: () => void;
  onFileFailure: () => void;
}): React.JSX.Element {
  const { code, message } = document.error;
  const engineFailed = isEngineFailure(code);
  useEffect(() => {
    if (engineFailed) {
      reportEngineFailure(message, {
        worker,
        onWorkerFailure,
        report: reportToHost,
      });
    } else {
      onFileFailure();
    }
  }, [engineFailed, message, onWorkerFailure, onFileFailure, worker]);
  return (
    <Status
      text={
        engineFailed
          ? "This PDF could not be opened."
          : "This PDF could not be opened: the file is damaged or is not a PDF."
      }
    />
  );
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
