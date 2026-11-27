import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { EditorView } from "@codemirror/view";
import { releaseReserveOnceMounted } from "../../../src/webview/ui/markdown-block-reserve";

type Request = {
  read: (view: EditorView) => unknown;
  write?: (value: unknown, view: EditorView) => void;
};

test("dropping a block's reserve makes CodeMirror read every line's height again", () => {
  const requests: Request[] = [];
  const viewState = { mustMeasureContent: false };
  const view = {
    viewState,
    requestMeasure: (request: Request) => requests.push(request),
  } as unknown as EditorView;
  const shell = {
    isConnected: true,
    style: { minHeight: "174px" },
  } as unknown as HTMLElement;
  const body = {
    querySelector: () => null,
    getBoundingClientRect: () => ({ height: 106 }),
  } as unknown as HTMLElement;

  releaseReserveOnceMounted(view, shell, body);
  const release = requests.shift()!;
  release.write!(release.read(view), view);

  assert.equal(shell.style.minHeight, "");
  assert.equal(viewState.mustMeasureContent, true);
  assert.equal(requests.length, 1, "and measures again in this frame");
});

test("the CodeMirror installed still has the internal flag the reserve sets", () => {
  // releaseReserveOnceMounted sets viewState.mustMeasureContent, which is not
  // public API. If an upgrade renames it, this fails instead of the bug
  // (a press below a just-rendered diagram revealing its source) returning.
  const require = createRequire(import.meta.url);
  const source = readFileSync(require.resolve("@codemirror/view"), "utf8");
  assert.match(source, /let measureContent = [^;]*this\.mustMeasureContent/);
});
