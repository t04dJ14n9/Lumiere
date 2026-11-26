import test from "node:test";
import assert from "node:assert/strict";
import { keymap } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import {
  EditorState,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import { createRoot } from "@workshop/core";
import { Endpoint } from "../../shared/rpc/endpoint";
import type { EditorService, MenuItem } from "../editor/api";
import type { MarkdownService } from "../dialect/api";
import type { BlockRenderer } from "../livePreview/api";
import { tablesWebview } from "./webview";
import { TableWidget } from "./widget";

type Root = ReturnType<typeof createRoot>;

/** What the fake editor hands out as the note's selection drawing. */
const noteSelection: Extension = [];

/** The tables plugin on fake services; `before` runs on the root first. */
async function startTables(before?: (root: Root) => void) {
  const root = createRoot();
  const renderers: BlockRenderer[] = [];
  const extensions: Extension[] = [];
  const commands = new Map<string, () => boolean | Promise<boolean>>();
  let document = EditorState.create();
  const view = {
    dom: new EventTarget(),
    scrollDOM: new EventTarget(),
    get state() {
      return document;
    },
    dispatch(spec: TransactionSpec) {
      document = document.update(spec).state;
    },
  } as unknown as EditorView;
  root.provide("editor", {
    view,
    selection: noteSelection,
    extend(extension: Extension) {
      extensions.push(extension);
      return () => {
        extensions.splice(extensions.indexOf(extension), 1);
      };
    },
    clipboard: {
      async read() {
        return "";
      },
      async write() {},
    },
  } as unknown as EditorService);
  root.provide("document", {
    extension: [],
    attach: () => () => {},
    async flush() {},
    pump() {},
    error: undefined,
  });
  root.provide("markdown", {
    language: () => [],
  } as unknown as MarkdownService);
  root.provide("livePreview", {
    mode: "livePreview",
    setMode() {},
    block(renderer) {
      renderers.push(renderer);
      return () => {
        renderers.splice(renderers.indexOf(renderer), 1);
      };
    },
    inline: () => () => {},
  });
  root.provide("render", {
    async into() {
      throw new Error("No DOM in unit test");
    },
  });
  root.provide("commands", {
    register(id, run) {
      commands.set(id, run);
      return () => {
        commands.delete(id);
      };
    },
    async run() {
      return false;
    },
  });
  const menus: (readonly MenuItem[])[] = [];
  root.provide("menu", {
    open: (_owner, items) => {
      menus.push(items);
      return () => {};
    },
  });
  const rpc = new Endpoint(
    { send() {}, listen: () => () => {} },
    { after: () => () => {} },
  );
  root.provide("rpc", rpc);
  before?.(root);
  const fiber = root.plugin(tablesWebview);
  await root.settled();
  return {
    root,
    fiber,
    renderers,
    extensions,
    commands,
    menus,
    document: () => document,
    async dispose() {
      await root.dispose();
      rpc.dispose();
    },
  };
}

const block = {
  kind: "Table",
  source: "| a | b |\n| --- | --- |\n| 1 | 2 |",
  from: 0,
  to: 33,
};

test("tables always register a widget and own their document-entry keys and commands", async () => {
  const tables = await startTables();
  const { renderers, extensions, commands } = tables;
  assert.equal(tables.fiber.state, "active");
  assert.equal(renderers[0]!.editing, "widget");
  assert.equal(renderers[0]!.showSource, undefined);
  const state = EditorState.create({ extensions });
  assert.deepEqual(
    state
      .facet(keymap)
      .flatMap((bindings) => bindings.map((binding) => binding.key)),
    ["ArrowUp", "ArrowDown"],
  );
  assert.ok(commands.has("editor:insert-table"));
  assert.equal(await commands.get("editor:insert-table")!(), true);
  const document = tables.document();
  assert.equal(
    document.doc.toString(),
    "\n|     |     |\n| --- | --- |\n|     |     |\n",
  );
  const widget = renderers[0]!.widget({
    kind: "Table",
    source: document.doc.toString(),
    from: 0,
    to: document.doc.length,
  });
  assert.ok(widget instanceof TableWidget);
  await tables.dispose();
  assert.equal(renderers.length, 0);
  assert.equal(extensions.length, 0);
  assert.equal(commands.size, 0);
});

test("a cell's editor draws its selection with the note's drawing", async () => {
  const tables = await startTables();
  const { environment } = tables.renderers[0]!.widget(block) as TableWidget;
  assert.equal(environment.selection, noteSelection);
  await tables.dispose();
});

test("render/changed gives the widgets Live Preview rebuilds a new revision", async () => {
  const rebuilt: TableWidget[] = [];
  // Live Preview rebuilds its widgets from its own render/changed listener,
  // registered before the tables plugin starts.
  const tables = await startTables((root) =>
    root.on("render/changed", () => {
      rebuilt.push(tables.renderers[0]!.widget(block) as TableWidget);
    }),
  );
  const before = tables.renderers[0]!.widget(block) as TableWidget;
  tables.root.emit("render/changed");
  await tables.root.settled();
  assert.equal(rebuilt.length, 1);
  // A changed revision makes updateDOM re-render the mounted cells.
  assert.notEqual(rebuilt[0]!.revision, before.revision);
  assert.equal(rebuilt[0]!.eq(before), false);
  await tables.dispose();
});

test("a table menu action that fails is reported on the table", async () => {
  const tables = await startTables();
  const { environment } = tables.renderers[0]!.widget(block) as TableWidget;
  const reported: string[] = [];
  environment.openMenu(
    {} as HTMLElement,
    [
      {
        label: "Row",
        children: [
          {
            label: "Paste",
            run: async () => {
              throw new Error("The table changed. Paste again.");
            },
          },
        ],
      },
    ],
    { x: 0, y: 0 },
    (message) => reported.push(message),
  );
  await tables.root.settled();
  await new Promise((resolve) => setTimeout(resolve));
  const paste = tables.menus[0]![0]!.children![0]!;
  // The menu logs the rejection; the table shows its message.
  await assert.rejects(async () => paste.run!(), /Paste again/);
  assert.deepEqual(reported, ["The table changed. Paste again."]);
  await tables.dispose();
});
