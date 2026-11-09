import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "@workshop/core";
import { provideHostServices } from "../../../src/shared/host";
import type { EditorPanel } from "../../../src/plugins/editor/api";
import { wordCountHost } from "../../../src/plugins/wordCount/host";
import { fakeHost } from "../../support/vscode-fake";

const NOTE = "file:///vault/Note.md";
const TEXT = "alpha beta gamma delta";

/** A Lumia editor on the note, whose webview selection is `selection`. */
function lumiaPanel(selection: string): EditorPanel {
  return {
    document: { uri: NOTE, getText: () => TEXT },
    rpc: { call: async () => ({ text: selection }) },
  } as unknown as EditorPanel;
}

async function start(options: {
  panels: EditorPanel[];
  active?: EditorPanel;
  textEditor?: { text: string; selection: string };
}) {
  const shown: string[] = [];
  const host = fakeHost({
    views: {
      status: () => ({
        show: (text: string) => shown.push(text),
        hide: () => {},
        dispose: () => {},
      }),
    } as never,
    activeEditor: {
      note: () => NOTE,
      textEditor: (uri: string) =>
        uri === NOTE ? options.textEditor : undefined,
    },
  });
  const root = createRoot();
  provideHostServices(root, host);
  root.provide("editors", {
    all: () => options.panels,
    active: () => options.active,
  } as never);
  root.plugin(wordCountHost);
  await root.settled();
  // The first count waits for the selection of a webview.
  for (let tick = 0; tick < 20; tick += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return { root, shown };
}

test("the focused text editor's selection is counted, not that of the note's Lumia editor in another group", async (t) => {
  const f = await start({
    panels: [lumiaPanel("alpha")],
    textEditor: { text: TEXT, selection: "beta gamma" },
  });
  t.after(() => f.root.dispose());
  assert.deepEqual(f.shown, ["2 words 10 characters"]);
});

test("the active Lumia editor's selection is counted even when a text editor shows the note", async (t) => {
  const panel = lumiaPanel("alpha");
  const f = await start({
    panels: [panel],
    active: panel,
    textEditor: { text: TEXT, selection: "beta gamma" },
  });
  t.after(() => f.root.dispose());
  assert.deepEqual(f.shown, ["1 word 5 characters"]);
});

test("a Lumia editor on the note is counted when no text editor shows it", async (t) => {
  const f = await start({ panels: [lumiaPanel("")] });
  t.after(() => f.root.dispose());
  assert.deepEqual(f.shown, ["4 words 22 characters"]);
});
