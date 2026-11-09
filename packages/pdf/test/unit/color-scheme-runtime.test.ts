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
function createLeakCountingRuntime() {
  const live = { memory: 0, callbacks: 0 };
  const runtime = {
    mem: {
      alloc: () => {
        live.memory++;
        return 8;
      },
      free: () => {
        live.memory--;
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
      },
    },
    fn: {
      FPDF_GetPageWidthF: () => 612,
      FPDF_GetPageHeightF: () => 792,
      FPDF_RenderPageBitmapWithColorScheme_Start: () => 1,
      FPDF_RenderPage_Continue: () => 1,
      FPDF_RenderPage_Close: () => {
        throw new Error("close failed");
      },
    },
  } as unknown as PdfRuntimeModule;
  return { runtime, live };
}

test("a render whose close throws still frees its scheme, pause and callback", () => {
  const { runtime, live } = createLeakCountingRuntime();
  const scheme = withColorScheme(runtime, INK);
  const ptr = (at: number) => at as unknown as Ptr;
  scheme.fn.EPDF_RenderPageBitmapWithMatrix_Start(
    ptr(2),
    ptr(3),
    ptr(4),
    ptr(0),
    0,
    16,
  );
  assert.deepEqual(live, { memory: 2, callbacks: 1 });
  assert.throws(() => scheme.fn.FPDF_RenderPage_Close(ptr(3)), /close failed/);
  assert.deepEqual(live, { memory: 0, callbacks: 0 });
});
