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
    requestZoom: (level: unknown, center: { vx: number; vy: number }) =>
      requests.push(`${String(level)} at ${center.vx},${center.vy}`),
  };
  // EmbedPDF's capabilities are the same objects on every render; a
  // document scope (`forDocument`) is a new object on every call.
  const zoomCapability = {
    forDocument: (id: string) => (id === "pdf" ? { ...zoom } : null),
  };
  let cleanup: (() => void) | undefined;
  let lastDeps: unknown[] | undefined;
  const modules: Record<string, unknown> = {
    react: {
      // React's rule: the effect runs again only when a dependency changed.
      useEffect: (effect: () => (() => void) | undefined, deps: unknown[]) => {
        if (lastDeps && deps.every((dep, i) => Object.is(dep, lastDeps![i]))) {
          return;
        }
        lastDeps = deps;
        cleanup?.();
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
      useZoomCapability: () => ({ provides: zoomCapability }),
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
  const render = () => module.exports.useFirstFitNow("pdf");
  render();
  const resize = (documentId: string, w: number, h: number) =>
    listener?.({ documentId, metrics: { clientWidth: w, clientHeight: h } });
  return {
    requests,
    resize,
    render,
    stop: () => cleanup?.(),
    stopped: () => stopped,
  };
}

test("the first size of the viewer fits the page at once; later sizes are left to the zoom plugin", () => {
  const h = harness({ zoomLevel: "fit-width" });
  h.resize("pdf", 0, 0);
  h.resize("other", 800, 600);
  assert.deepEqual(h.requests, [], "no size yet, or another document");
  h.resize("pdf", 800, 600);
  assert.deepEqual(h.requests, ["fit-width at 400,0"], "the top stays put");
  h.resize("pdf", 900, 600);
  assert.deepEqual(h.requests, ["fit-width at 400,0"], "only the first size");
  h.stop();
  assert.ok(h.stopped());
});

test("a size that arrived before the listener fits at once, and a number zoom is left alone", () => {
  const early = harness({ zoomLevel: "fit-page", mounted: { w: 800, h: 600 } });
  assert.deepEqual(early.requests, ["fit-page at 400,0"]);
  early.resize("pdf", 800, 600);
  assert.deepEqual(early.requests, ["fit-page at 400,0"]);
  const numeric = harness({ zoomLevel: 1.5 });
  numeric.resize("pdf", 800, 600);
  assert.deepEqual(
    numeric.requests,
    [],
    "a remembered number is restored elsewhere",
  );
});

test("rendering again fits nothing again", () => {
  // The fit puts the top of the view back; after a jump, a second fit would
  // undo the jump (and, from inside a render, never settle).
  const h = harness({ zoomLevel: "fit-width", mounted: { w: 800, h: 600 } });
  h.render();
  h.render();
  h.resize("pdf", 800, 600);
  assert.deepEqual(h.requests, ["fit-width at 400,0"]);
  assert.ok(!h.stopped(), "still the first effect");
});
