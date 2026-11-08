import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

type RequestZoomWithLayout = (
  zoom: { requestZoom(level: unknown, center?: unknown): void },
  level: unknown,
  center?: { vx: number; vy: number },
) => void;

/** webview/zoom-request.ts with React's flushSync replaced by one that logs. */
function load(events: string[]): RequestZoomWithLayout {
  const source = readFileSync(
    new URL("../../src/webview/zoom-request.ts", import.meta.url),
    "utf8",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const modules: Record<string, unknown> = {
    "react-dom": {
      // What the real one does: run the callback, then commit what it scheduled.
      flushSync: (callback: () => void) => {
        events.push("flushSync starts");
        callback();
        events.push("layout committed");
      },
    },
  };
  const module = {
    exports: {} as { requestZoomWithLayout?: RequestZoomWithLayout },
  };
  (
    runInNewContext(`(function(require,module,exports){${output}\n})`) as (
      require: (id: string) => unknown,
      module: unknown,
      exports: unknown,
    ) => void
  )((id) => modules[id], module, module.exports);
  assert.ok(module.exports.requestZoomWithLayout);
  return module.exports.requestZoomWithLayout;
}

test("a zoom is requested inside flushSync, so its layout is committed before the next frame scrolls to its anchor", () => {
  const events: string[] = [];
  const requestZoomWithLayout = load(events);
  requestZoomWithLayout(
    { requestZoom: () => events.push("zoom requested") },
    1.25,
  );
  assert.deepEqual(events, [
    "flushSync starts",
    "zoom requested",
    "layout committed",
  ]);
});

test("the level and the anchor reach EmbedPDF unchanged", () => {
  const events: string[] = [];
  const requestZoomWithLayout = load(events);
  const requests: unknown[][] = [];
  const zoom = {
    requestZoom: (...args: unknown[]) => requests.push(args),
  };
  requestZoomWithLayout(zoom, 2, { vx: 10, vy: 20 });
  requestZoomWithLayout(zoom, "fit-width");
  assert.deepEqual(requests, [
    [2, { vx: 10, vy: 20 }],
    ["fit-width", undefined],
  ]);
});
