/**
 * The PDF viewer page. It asks the extension for the PDF, then starts the
 * engine and the viewer. A new `load` (the file changed) restarts the viewer
 * and keeps the engine.
 *
 *   host.ts              messages to and from the extension
 *   engine-host.ts       the page's PDF engine, kept across reloads and
 *                        stopped when the page goes
 *   engine.tsx           PDFium startup (worker, with a main-thread fallback)
 *   viewer.tsx           toolbar, search and pages
 */
import "./l10n-init";
import React from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  browserEngineEnvironment,
  type ViewerEngine,
} from "./browser-render-environment";
import { PdfEngine, Status } from "./engine";
import { EngineHost } from "./engine-host";
import { connectToHost } from "./host";
import "@vscode/codicons/dist/codicon.css";
import "./styles/base.css";
import "./styles/toolbar.css";
import "./styles/page.css";
import "./styles/view-controls.css";
import "./styles/note-card.css";
import "./styles/side-panel.css";

performance.mark("pdf:main");
const container = document.getElementById("root");
if (!container) {
  throw new Error("The viewer page has no #root element");
}
// The attribute keeps its name: PDFium is still what the file holds.
const wasmUrl = container.dataset.pdfiumWasm;
const root = createRoot(container);

if (!wasmUrl) {
  root.render(
    <Status text="The PDF engine is missing from this installation." />,
  );
} else {
  const host = new EngineHost<ViewerEngine>(browserEngineEnvironment(wasmUrl));
  // The engine's worker starts, and its WASM downloads and compiles, while
  // the host sends the PDF. A failure here surfaces when the PDF is opened.
  host.engine("worker").then(
    (engine) => engine.warmup(),
    () => undefined,
  );
  let generation = 0;
  root.render(<Status text="Loading the PDF…" />);
  connectToHost((buffer) => {
    performance.mark("pdf:buffer");
    // Replace the old viewer first (flushSync unmounts it now), so nothing
    // still on screen is open when the new document is.
    flushSync(() =>
      root.render(
        <PdfEngine
          key={++generation}
          host={host}
          bytes={{ current: buffer }}
        />,
      ),
    );
  });
  window.addEventListener("pagehide", () => {
    void host.dispose();
  });
}
