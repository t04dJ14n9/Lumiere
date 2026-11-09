/**
 * The real EngineHost environment: EmbedPDF's local engine, in a worker or on
 * the main thread, and the fetch of its WASM. Kept apart from engine-host.ts
 * so that file has no browser or EmbedPDF imports and can be unit-tested
 * under Node.
 *
 * Both engines run Lumiere's host (src/engine-worker), which draws dark paper:
 * the worker is its own script, and the main-thread engine its own transport.
 */
import { LocalEngine, localEngine } from "@embedpdf/engine";
import { createPdfRuntime } from "@embedpdf/engine-runtime";
import { DarkInlineTransport } from "../engine-worker/inline-transport";
import type { PageColorsMessage } from "../shared/page-colors-engine";
import type { EngineEnvironment, EngineMode } from "./engine-host";
import { connectEnginePageColors } from "./page-colors";

export type ViewerEngine = LocalEngine;

/**
 * The WASM blob, fetched once. `warmWasm` starts the fetch while the host is
 * still sending the PDF, so the engine need not wait for it; a failed fetch
 * is forgotten so the next attempt tries again.
 *
 * Lifetime: a webview has one engine URL, so only the latest URL is kept (a
 * different URL replaces the old blob, nothing accumulates), and the cache is
 * module state that goes with the webview when its panel closes.
 */
let warmed: { url: string; blob: Promise<Blob> } | undefined;
export function warmWasm(url: string): Promise<Blob> {
  if (warmed?.url === url) {
    return warmed.blob;
  }
  const blob = fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error(`PDF engine request failed (${response.status})`);
    }
    return response.blob();
  });
  const entry = { url, blob };
  warmed = entry;
  blob.catch(() => {
    if (warmed === entry) {
      warmed = undefined;
    }
  });
  return blob;
}

/**
 * Lumiere's engine worker's script, built into viewer.js as a string
 * (scripts/engine-worker.mjs). Imported when a worker is wanted, so that
 * what only warms the WASM (a Node test) need not resolve the bundler's
 * module.
 */
async function engineWorkerScript(): Promise<string> {
  return (await import("lumiere:engine-worker")).default;
}

/**
 * Lumiere's engine worker, from a blob URL: a worker's script must come from
 * the page's own origin, and the extension's resources do not. The page
 * tells it the page colours before the engine says where its WASM is.
 */
function startEngineWorker(script: string): Worker {
  const url = URL.createObjectURL(
    new Blob([script], { type: "text/javascript" }),
  );
  try {
    const worker = new Worker(url, { type: "module" });
    // Once the worker speaks it has read its script.
    worker.addEventListener("message", () => URL.revokeObjectURL(url), {
      once: true,
    });
    connectEnginePageColors((mode) => {
      const message: PageColorsMessage = { kind: "lumiere.pageColors", mode };
      worker.postMessage(message);
    });
    return worker;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/**
 * The engine in a worker, which keeps rendering off the thread that scrolls.
 * The worker starts from a blob URL and cannot fetch the extension's resource
 * URL itself, so the page fetches the WASM (it is allowed to) and hands the
 * engine the bytes. Nothing is booted until the first document or `warmup()`.
 */
function workerEngine(wasmUrl: string, script: string): ViewerEngine {
  return localEngine({
    worker: () => startEngineWorker(script),
    encoderWorker: "inline",
    wasmLoader: async () => (await warmWasm(wasmUrl)).arrayBuffer(),
    // Never load the Hebrew and Arabic fallback fonts; the viewer works offline
    // and ships without them.
    defaultFallbackFonts: false,
  });
}

/** The engine on the main thread, for a worker that cannot start. */
async function mainThreadEngine(wasmUrl: string): Promise<ViewerEngine> {
  const runtime = await createPdfRuntime({
    prefer: "wasm",
    wasmBinary: await (await warmWasm(wasmUrl)).arrayBuffer(),
  });
  const transport = new DarkInlineTransport(runtime);
  connectEnginePageColors((mode) => transport.setPageColors(mode));
  return LocalEngine.fromTransport({ transport });
}

/** The engines of the viewer page, whose WASM is at `wasmUrl`. */
export function browserEngineEnvironment(
  wasmUrl: string,
): EngineEnvironment<ViewerEngine> {
  return {
    create: async (mode: EngineMode) =>
      mode === "worker"
        ? workerEngine(wasmUrl, await engineWorkerScript())
        : mainThreadEngine(wasmUrl),
    // v3 closes what is still queued, asks the worker to stop and terminates
    // it within 50 ms, so no deadline of ours is needed.
    destroy: (engine) => engine.destroy(),
    reportError: (message, error) => console.warn(message, error),
  };
}
