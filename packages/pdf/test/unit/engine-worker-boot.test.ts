/**
 * The engine worker's boot (src/engine-worker/worker-boot.ts) on a stand-in
 * for the worker's global scope: the handshake EmbedPDF's engine waits for,
 * and the page colours the viewer posts, before and after it.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { LocalEngine, type Transport } from "@embedpdf/engine";
import type {
  WirePack,
  WorkerRequest,
  WorkerResponse,
} from "@embedpdf/engine-core/runtime";
import {
  startEngineWorker,
  type WorkerScope,
} from "../../src/engine-worker/worker-boot";
import { DARK_PALETTE } from "../../src/shared/dark-page";
import { FIGURE, figurePdf } from "../fixtures/make-fixtures.mjs";
import { paperOf } from "../support/dark-figure";

const wasm = readFileSync(
  createRequire(import.meta.url).resolve(
    "@embedpdf/engine-runtime-wasm32/embedpdf.wasm",
  ),
);

/** A worker scope whose main thread is this test. */
function workerThread() {
  const handlers = new Set<(response: WorkerResponse) => void>();
  const handshakes: { kind: string; error?: string }[] = [];
  let answered: () => void = () => undefined;
  const handshake = new Promise<void>((resolve) => {
    answered = resolve;
  });
  const scope: WorkerScope = {
    onmessage: null,
    postMessage(message) {
      const { kind } = message as { kind: string };
      if (kind === "ready" || kind === "init-error") {
        handshakes.push(message as { kind: string; error?: string });
        answered();
        return;
      }
      for (const handler of handlers) {
        handler(message as WorkerResponse);
      }
    },
  };
  /** What the main thread posts to the worker. */
  const post = (data: unknown): void =>
    scope.onmessage!({ data } as MessageEvent);
  const transport: Transport = {
    send: (pack: WirePack<WorkerRequest>) => post(pack.payload),
    onMessage(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    terminate: async () => undefined,
  };
  startEngineWorker(scope);
  return { post, transport, handshake, handshakes };
}

/** The paper of figure.pdf as the worker draws it now. */
async function paper(engine: LocalEngine): Promise<readonly number[]> {
  const document = await engine.open({ kind: "bytes", bytes: figurePdf() });
  try {
    const { pages } = await document.pages.list();
    const raster = await document.page(pages[0]!.ref).render.raw({
      viewport: { kind: "scale", scale: 1 },
    });
    return paperOf(
      {
        width: raster.width,
        height: raster.height,
        data: new Uint8ClampedArray(raster.data),
      },
      FIGURE,
    );
  } finally {
    await document.close();
  }
}

test("the worker answers ready once it has the WASM, and draws the page colours the viewer posted before that", async () => {
  const worker = workerThread();
  worker.post({ kind: "lumiere.pageColors", mode: "dark" });
  worker.post({
    kind: "init",
    wasmBinary: wasm.buffer.slice(
      wasm.byteOffset,
      wasm.byteOffset + wasm.byteLength,
    ),
  });
  await worker.handshake;
  assert.deepEqual(worker.handshakes, [{ kind: "ready" }]);
  const engine = LocalEngine.fromTransport({ transport: worker.transport });
  try {
    assert.deepEqual(await paper(engine), DARK_PALETTE.background);
    worker.post({ kind: "lumiere.pageColors", mode: "normal" });
    assert.deepEqual(await paper(engine), [255, 255, 255]);
    worker.post({ kind: "lumiere.pageColors", mode: "dark" });
    assert.deepEqual(await paper(engine), DARK_PALETTE.background);
  } finally {
    await engine.destroy();
  }
});

test("a worker that cannot start its PDFium says why", async () => {
  const worker = workerThread();
  worker.post({ kind: "init", wasmBinary: new ArrayBuffer(8) });
  await worker.handshake;
  assert.equal(worker.handshakes.length, 1);
  assert.equal(worker.handshakes[0]!.kind, "init-error");
  assert.match(
    worker.handshakes[0]!.error!,
    /failed to start the PDF engine worker/,
  );
});
