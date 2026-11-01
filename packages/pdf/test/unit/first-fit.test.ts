import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

/** webview/first-fit.ts with EmbedPDF's viewport and zoom replaced by fakes. */
function harness(options: {
  zoomLevel: unknown;
  mounted?: { w: number; h: number };
}) {
  const requests: unknown[] = [];
  let listener: ((event: unknown) => void) | undefined;
  let stopped = false;
  const viewport = {
    onViewportResize: (callback: (event: unknown) => void) => {
      listener = callback;
      return () => {
        stopped = true;
      };
    },
    isViewportMounted: () => options.mounted !== undefined,
    forDocument: () => ({
      getMetrics: () => ({
        clientWidth: options.mounted?.w ?? 0,
        clientHeight: options.mounted?.h ?? 0,
      }),
    }),
  };
  const zoom = {
    getState: () => ({ zoomLevel: options.zoomLevel }),
    requestZoom: (level: unknown) => requests.push(level),
  };
  let cleanup: (() => void) | undefined;
  const modules: Record<string, unknown> = {
    react: {
      useEffect: (effect: () => (() => void) | undefined) => {
        cleanup = effect();
      },
    },
    "@embedpdf/plugin-viewport/react": {
      useViewportCapability: () => ({ provides: viewport }),
    },
    "@embedpdf/plugin-zoom/react": {
      ZoomMode: {
        FitWidth: "fit-width",
        FitPage: "fit-page",
        Automatic: "automatic",
      },
      useZoom: () => ({ provides: zoom }),
    },
  };
  const source = readFileSync(
    new URL("../../src/webview/first-fit.ts", import.meta.url),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const module = { exports: {} as { useFirstFitNow(id: string): void } };
  (
    runInNewContext(`(function(require,module,exports){${output}\n})`) as (
      require: (id: string) => unknown,
      module: unknown,
      exports: unknown,
    ) => void
  )((id) => modules[id], module, module.exports);
  module.exports.useFirstFitNow("pdf");
  const resize = (documentId: string, w: number, h: number) =>
    listener?.({ documentId, metrics: { clientWidth: w, clientHeight: h } });
  return { requests, resize, stop: () => cleanup?.(), stopped: () => stopped };
}

test("the first size of the viewer fits the page at once; later sizes are left to the zoom plugin", () => {
  const h = harness({ zoomLevel: "fit-width" });
  h.resize("pdf", 0, 0);
  h.resize("other", 800, 600);
  assert.deepEqual(h.requests, [], "no size yet, or another document");
  h.resize("pdf", 800, 600);
  assert.deepEqual(h.requests, ["fit-width"]);
  h.resize("pdf", 900, 600);
  assert.deepEqual(h.requests, ["fit-width"], "only the first size");
  h.stop();
  assert.ok(h.stopped());
});

test("a size that arrived before the listener fits at once, and a number zoom is left alone", () => {
  const early = harness({ zoomLevel: "fit-page", mounted: { w: 800, h: 600 } });
  assert.deepEqual(early.requests, ["fit-page"]);
  early.resize("pdf", 800, 600);
  assert.deepEqual(early.requests, ["fit-page"]);
  const numeric = harness({ zoomLevel: 1.5 });
  numeric.resize("pdf", 800, 600);
  assert.deepEqual(
    numeric.requests,
    [],
    "a remembered number is restored elsewhere",
  );
});
