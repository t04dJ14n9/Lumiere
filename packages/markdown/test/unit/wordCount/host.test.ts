import assert from "node:assert/strict";
import test from "node:test";
import { createRoot } from "@workshop/core";
import { provideHostServices } from "../../../src/shared/host";
import type { EditorPanel } from "../../../src/plugins/editor/api";
import { wordCountHost } from "../../../src/plugins/wordCount/host";
import { fakeHost } from "../../support/vscode-fake";

const NOTE = "file:///vault/Note.md";
const TEXT = "alpha beta gamma delta";

/** A Lumiere editor on the note, whose webview selection is `selection`. */
function lumierePanel(selection: string): EditorPanel {
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

test("the focused text editor's selection is counted, not that of the note's Lumiere editor in another group", async (t) => {
  const f = await start({
    panels: [lumierePanel("alpha")],
    textEditor: { text: TEXT, selection: "beta gamma" },
  });
  t.after(() => f.root.dispose());
  assert.deepEqual(f.shown, ["2 words 10 characters"]);
});

test("the active Lumiere editor's selection is counted even when a text editor shows the note", async (t) => {
  const panel = lumierePanel("alpha");
  const f = await start({
    panels: [panel],
    active: panel,
    textEditor: { text: TEXT, selection: "beta gamma" },
  });
  t.after(() => f.root.dispose());
  assert.deepEqual(f.shown, ["1 word 5 characters"]);
});

test("a caret move does not count the whole note again until its text changes", async (t) => {
  let reads = 0;
  let version = 1;
  const panel = {
    document: {
      uri: NOTE,
      get version() {
        return version;
      },
      getText: () => {
        reads++;
        return TEXT;
      },
    },
    rpc: { call: async () => ({ text: "" }) },
  } as unknown as EditorPanel;
  const f = await start({ panels: [panel], active: panel });
  t.after(() => f.root.dispose());
  const caretMoved = async () => {
    f.root.emit("editor/selectionChanged", panel, false);
    await new Promise((resolve) => setTimeout(resolve, 300));
  };
  assert.equal(reads, 1);

  await caretMoved();
  assert.equal(reads, 1);

  version = 2;
  await caretMoved();
  assert.equal(reads, 2);
  assert.equal(f.shown.at(-1), "4 words 22 characters");
});

test("a Lumiere editor on the note is counted when no text editor shows it", async (t) => {
  const f = await start({ panels: [lumierePanel("")] });
  t.after(() => f.root.dispose());
  assert.deepEqual(f.shown, ["4 words 22 characters"]);
});
