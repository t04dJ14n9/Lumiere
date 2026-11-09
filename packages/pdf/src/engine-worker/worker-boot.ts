/**
 * The worker's boot, as EmbedPDF's own (`@embedpdf/engine/worker-entry`) does
 * it, with Lumiere's host (dark-host.ts) in place of the stock one: wait for the
 * `init` message that says where the WASM is, start PDFium with it, answer
 * `ready` (or `init-error`), then hand every request to the host.
 *
 * The protocol is the one `BrowserWorkerTransport` in @embedpdf/engine
 * speaks, so the engine starts this worker as it would its own.
 *
 * The viewer may post the page colours (shared/page-colors-engine.ts) before
 * `init`, as soon as it has made the worker: the mode waits for the host.
 */
import type { EngineWorkerInit } from "@embedpdf/engine";
import { createPdfRuntime } from "@embedpdf/engine-runtime";
import type { WorkerRequest } from "@embedpdf/engine-core/runtime";
import type { EffectivePageColors } from "../shared/page-colors";
import { parsePageColorsMessage } from "../shared/page-colors-engine";
import { createDarkHost, type DarkHost } from "./dark-host";

/** The part of a dedicated worker's global scope the boot uses. */
export interface WorkerScope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

function isInit(data: unknown): data is EngineWorkerInit {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { kind?: unknown }).kind === "init"
  );
}

/** PDFium with the WASM the main thread decided on: its URL, or its bytes. */
async function startHost(
  scope: WorkerScope,
  init: EngineWorkerInit,
): Promise<DarkHost> {
  const runtime = await createPdfRuntime({
    prefer: "wasm",
    ...(init.wasmUrl === undefined ? {} : { wasmUrl: init.wasmUrl }),
    ...(init.wasmBinary === undefined ? {} : { wasmBinary: init.wasmBinary }),
  });
  // The pack carries the response and the buffers it moves, not copies, to
  // the main thread.
  return createDarkHost(runtime, (pack) =>
    scope.postMessage(pack.payload, pack.transfer as Transferable[]),
  );
}

/** Arm the worker: it does nothing until the main thread posts `init`. */
export function startEngineWorker(scope: WorkerScope): void {
  let mode: EffectivePageColors = "normal";
  let host: DarkHost | undefined;
  let booting = false;
  scope.onmessage = ({ data }) => {
    const colors = parsePageColorsMessage(data);
    if (colors !== undefined) {
      mode = colors;
      host?.setPageColors(colors);
      return;
    }
    if (host) {
      host.receive(data as WorkerRequest);
      return;
    }
    if (!isInit(data) || booting) {
      return;
    }
    booting = true;
    startHost(scope, data).then(
      (started) => {
        started.setPageColors(mode);
        host = started;
        scope.postMessage({ kind: "ready" });
      },
      (error: unknown) => {
        const detail = String((error as Error)?.stack ?? error);
        scope.postMessage({
          kind: "init-error",
          error: `failed to start the PDF engine worker: ${detail}`,
        });
      },
    );
  };
}
