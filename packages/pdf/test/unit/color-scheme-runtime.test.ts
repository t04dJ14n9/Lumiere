/**
 * The colour-scheme render's structs (src/engine-worker/color-scheme-runtime.ts)
 * live from a render's start to its close, whatever the close does.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PdfRuntimeModule, Ptr } from "@embedpdf/engine-runtime";
import { withColorScheme } from "../../src/engine-worker/color-scheme-runtime";

const INK = {
  pathFill: "#01000000",
  pathStroke: "#01000000",
  textFill: "#01000000",
  textStroke: "#01000000",
};

/** A runtime that counts what is allocated and freed, and whose close throws. */
function createLeakCountingRuntime(closeError = new Error("close failed")) {
  const live = { memory: 0, callbacks: 0 };
  const calls = { frees: 0, disposals: 0 };
  const runtime = {
    mem: {
      alloc: () => {
        live.memory++;
        return 8;
      },
      free: () => {
        live.memory--;
        calls.frees++;
      },
      poke: () => {},
      peek: () => 0,
    },
    cb: {
      register: () => {
        live.callbacks++;
        return 1;
      },
      dispose: () => {
        live.callbacks--;
        calls.disposals++;
      },
    },
    fn: {
      FPDF_GetPageWidthF: () => 612,
      FPDF_GetPageHeightF: () => 792,
      FPDF_RenderPageBitmapWithColorScheme_Start: () => 1,
      FPDF_RenderPage_Continue: () => 1,
      FPDF_RenderPage_Close: () => {
        throw closeError;
      },
    },
  } as unknown as PdfRuntimeModule;
  return { runtime, live, calls };
}

test("a throwing close frees its structs and leaves the next render ready", () => {
  const closeError = new Error("close failed");
  const { runtime, live, calls } = createLeakCountingRuntime(closeError);
  const scheme = withColorScheme(runtime, INK);
  const ptr = (at: number) => at as unknown as Ptr;
  const start = () =>
    scheme.fn.EPDF_RenderPageBitmapWithMatrix_Start(
      ptr(2),
      ptr(3),
      ptr(4),
      ptr(0),
      0,
      16,
    );
  const close = () => scheme.fn.FPDF_RenderPage_Close(ptr(3));
  start();
  assert.deepEqual(live, { memory: 2, callbacks: 1 });
  assert.throws(close, (error: unknown) => error === closeError);
  assert.deepEqual(live, { memory: 0, callbacks: 0 });
  assert.deepEqual(calls, { frees: 2, disposals: 1 });

  // The next render owns fresh structs: the failed close left none behind.
  start();
  assert.deepEqual(live, { memory: 2, callbacks: 1 });
  assert.throws(close, (error: unknown) => error === closeError);
  assert.deepEqual(live, { memory: 0, callbacks: 0 });
  assert.deepEqual(calls, { frees: 4, disposals: 2 });
});
