import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, StateEffect } from "@codemirror/state";
import type { TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Plugin } from "@workshop/core";
import { calloutsWebview } from "../../../src/plugins/callouts/webview";
import { embedsWebview } from "../../../src/plugins/embeds/webview";
import {
  footnotesWebview,
  insertFootnoteCommand,
} from "../../../src/plugins/footnotes/webview";
import { linksWebview } from "../../../src/plugins/links/webview";
import { mathWebview } from "../../../src/plugins/math/webview";
import { PropertyEditing } from "../../../src/plugins/properties/editing";
import type { TableController } from "../../../src/plugins/tables/controller";
import { tableCommands } from "../../../src/plugins/tables/manifest";
import { activeTables } from "../../../src/plugins/tables/state";
import { tablesWebview } from "../../../src/plugins/tables/webview";
import { noteReadOnly } from "../../../src/plugins/editor/api";
import { formattingCommands } from "../../../src/plugins/formatting/webview";
import { tasksWebview } from "../../../src/plugins/tasks/webview";
import { fixture } from "./fixture";

// CodeMirror's readOnly facet is advice to commands, not a filter on
// transactions: an editing command that does not check it edits the note
// anyway (#812). In VS Code the editor turns read-only when syncing fails for
// good, so such an edit never reaches the note. The formatting plugin's
// commands check it (their own tests); these are the other plugins' editing
// commands, run through their registered handlers where the unit fixture can
// run the plugin.
const EDITING_COMMANDS: [Plugin<unknown>, string[]][] = [
  [mathWebview, ["editor:insert-mathblock", "editor:toggle-inline-math"]],
  [linksWebview, ["editor:insert-wikilink"]],
  [embedsWebview, ["editor:insert-embed"]],
  [calloutsWebview, ["editor:insert-callout"]],
  [
    tasksWebview,
    ["editor:toggle-checklist-status", "editor:cycle-list-checklist"],
  ],
  [tablesWebview, ["editor:insert-table"]],
];

const DOC = "alpha";

/**
 * Starts `plugin` in the unit fixture on `alpha`, the caret after it, and
 * runs `check` with the fixture.
 */
async function withPlugin<T>(
  plugin: Plugin<unknown>,
  readOnly: boolean,
  check: (f: ReturnType<typeof fixture>) => Promise<T>,
): Promise<T> {
  const f = fixture();
  try {
    f.root.plugin(plugin);
    await f.root.settled();
    f.view.dispatch({
      changes: { from: 0, to: f.view.state.doc.length, insert: DOC },
      selection: { anchor: DOC.length },
      effects: StateEffect.appendConfig.of(EditorState.readOnly.of(readOnly)),
    });
    return await check(f);
  } finally {
    await f.root.dispose();
  }
}

/** Runs a plugin's registered command on `alpha`. */
function runOnAlpha(
  plugin: Plugin<unknown>,
  id: string,
  readOnly: boolean,
): Promise<{ result: boolean; doc: string }> {
  return withPlugin(plugin, readOnly, async (f) => {
    const run = f.handlers.get(id);
    assert.ok(run, `${id} is registered`);
    const result = await run();
    return { result, doc: f.view.state.doc.toString() };
  });
}

/** A view over `doc` that counts its dispatches. */
function fakeView(
  doc: string,
  readOnly: boolean,
  dom: object = {},
): { view: EditorView; dispatches: () => number } {
  let state = EditorState.create({
    doc,
    extensions: [EditorState.readOnly.of(readOnly)],
  });
  let dispatches = 0;
  const view = {
    get state() {
      return state;
    },
    dom,
    dispatch(spec: TransactionSpec) {
      dispatches++;
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
  return { view, dispatches: () => dispatches };
}

test("editing commands refuse a read-only editor and leave the note as it is", async () => {
  for (const [plugin, ids] of EDITING_COMMANDS) {
    for (const id of ids) {
      assert.deepEqual(
        await runOnAlpha(plugin, id, true),
        { result: false, doc: DOC },
        id,
      );
    }
  }
  // Its definition popover needs a DOM the fixture lacks, so a writable run
  // is checked through `insertFootnoteCommand` below.
  assert.deepEqual(
    await runOnAlpha(footnotesWebview, "editor:insert-footnote", true),
    { result: false, doc: DOC },
  );
});

test("the same commands edit a writable editor", async () => {
  for (const [plugin, ids] of EDITING_COMMANDS) {
    for (const id of ids) {
      const { result, doc } = await runOnAlpha(plugin, id, false);
      assert.equal(result, true, id);
      assert.notEqual(doc, DOC, id);
    }
  }
  assert.deepEqual(
    await runOnAlpha(mathWebview, "editor:insert-mathblock", false),
    { result: true, doc: "$$\nalpha\n$$" },
  );
});

test("the table commands refuse a read-only editor before the table writes", async () => {
  for (const readOnly of [true, false]) {
    await withPlugin(tablesWebview, readOnly, async (f) => {
      let started = 0;
      let finished = 0;
      // The active table's controller is the one part that writes; its
      // execute is asynchronous (a sort renders its keys first), so a
      // refusal must come before it starts.
      activeTables.set(f.view, {
        range: undefined,
        active: { row: 1, column: 0 },
        execute: async () => {
          started++;
          await Promise.resolve();
          finished++;
        },
      } as unknown as TableController);
      for (const [id] of tableCommands) {
        const run = f.handlers.get(`editor:table-${id}`);
        assert.ok(run, id);
        assert.equal(await run(), !readOnly, id);
      }
      assert.equal(started, readOnly ? 0 : tableCommands.length);
      // A writable run resolves only once the table's edit is done.
      assert.equal(finished, started);
    });
  }
});

test("Insert Footnote refuses a read-only editor with no popover, and edits a writable one", () => {
  for (const readOnly of [true, false]) {
    const { view, dispatches } = fakeView(DOC, readOnly);
    const opened: string[] = [];
    const result = insertFootnoteCommand(view, (label) => opened.push(label));
    assert.equal(result, !readOnly);
    assert.equal(dispatches(), readOnly ? 0 : 1);
    assert.equal(opened.length, readOnly ? 0 : 1);
    assert.equal(view.state.doc.toString() === DOC, readOnly);
  }
});

test("Add file property, Add alias and Clear file properties refuse a read-only editor", () => {
  const original = (globalThis as { document?: unknown }).document;
  // Only "is a dialog open" is asked of the page.
  (globalThis as { document?: unknown }).document = {
    querySelector: () => null,
  };
  try {
    const source = "---\na: 1\n---\nalpha";
    for (const readOnly of [true, false]) {
      const dom = {
        querySelectorAll: () => [],
        querySelector: () => ({ focus() {}, click() {} }),
      };
      const { view, dispatches } = fakeView(source, readOnly, dom);
      let shown = 0;
      const editing = new PropertyEditing({
        view: () => view,
        setStatus: () => {},
        action: () => {},
        refresh: () => {},
        setType: () => {},
        show: () => {
          shown++;
        },
        focusTitle: () => {},
        pageHeading: () => {},
        signal: new AbortController().signal,
      });
      assert.equal(editing.add(), !readOnly, "add");
      assert.equal(editing.addAlias(), !readOnly, "addAlias");
      if (readOnly) {
        assert.equal(editing.clear(), false, "clear");
        assert.equal(dispatches(), 0);
        assert.equal(shown, 0);
        assert.equal(view.state.doc.toString(), source);
      } else {
        assert.match(view.state.doc.toString(), /aliases/u);
        assert.equal(editing.clear(), true, "clear");
        assert.equal(view.state.doc.toString(), "alpha");
        assert.equal(shown, 2);
      }
    }
  } finally {
    (globalThis as { document?: unknown }).document = original;
  }
});

/**
 * Loads `features` through the feature controller, as the webview does (so
 * each gets its configuration), on `doc`, read-only or not, and runs `check`.
 */
async function withFeatures<T>(
  features: string[],
  options: { doc: string; readOnly: boolean },
  check: (f: ReturnType<typeof fixture>) => Promise<T>,
): Promise<T> {
  const f = fixture();
  try {
    await f.configure(
      Object.fromEntries(
        features.map((id) => [id, { enabled: true, config: {} }]),
      ),
    );
    await f.root.settled();
    f.view.dispatch({
      changes: { from: 0, to: f.view.state.doc.length, insert: options.doc },
      selection: { anchor: options.doc.length },
      effects: StateEffect.appendConfig.of(
        EditorState.readOnly.of(options.readOnly),
      ),
    });
    return await check(f);
  } finally {
    await f.root.dispose();
  }
}

async function run(f: ReturnType<typeof fixture>, id: string) {
  const handler = f.handlers.get(id);
  assert.ok(handler, `${id} is registered`);
  return handler();
}

test("Toggle Inline Math through the formatting plugin refuses a read-only editor", async () => {
  for (const readOnly of [true, false]) {
    await withFeatures(
      ["math", "formatting"],
      { doc: DOC, readOnly },
      async (f) => {
        assert.equal(await run(f, "editor:toggle-inline-math"), !readOnly);
        assert.equal(f.view.state.doc.toString() === DOC, readOnly);
      },
    );
  }
});

// Formatting commands run on the active view: an open table cell's own
// editor, whose state carries the note's read-only state (the cell editor
// builds it with the editor's `noteReadOnly`). Without it they edited the cell, and the
// cell wrote the edit into the read-only note.
test("formatting commands in an open table cell refuse a read-only note", async () => {
  // Commands that only move the selection.
  const selectionOnly = new Set([
    "editor:add-cursor-above",
    "editor:add-cursor-below",
  ]);
  const ids = [...formattingCommands().keys()].filter(
    (id) => !selectionOnly.has(id),
  );
  const cellText = "cell text";
  for (const readOnly of [true, false]) {
    await withFeatures(
      ["formatting", "tables"],
      { doc: DOC, readOnly },
      async (f) => {
        let cell = EditorState.create({
          doc: cellText,
          selection: { anchor: 0, head: 4 },
          extensions: noteReadOnly(f.view.state),
        });
        const cellView = {
          get state() {
            return cell;
          },
          dispatch(spec: TransactionSpec) {
            cell = cell.update(spec).state;
          },
          focus() {},
        } as unknown as EditorView;
        activeTables.set(f.view, {
          editor: cellView,
        } as unknown as TableController);
        if (readOnly) {
          for (const id of ids) {
            assert.equal(await run(f, id), false, id);
          }
          assert.equal(cell.doc.toString(), cellText);
        } else {
          assert.equal(await run(f, "editor:toggle-bold"), true);
          assert.equal(cell.doc.toString(), "**cell** text");
        }
        assert.equal(f.view.state.doc.toString(), DOC);
      },
    );
  }
});

test("the Properties commands, as registered, refuse a read-only editor", async () => {
  const note = "---\na: 1\n---\nalpha";
  const ids = [
    "markdown:add-metadata-property",
    "markdown:add-alias",
    "markdown:clear-metadata-properties",
  ];
  await withFeatures(
    ["properties"],
    { doc: note, readOnly: true },
    async (f) => {
      for (const id of ids) {
        assert.equal(await run(f, id), false, id);
      }
      assert.equal(f.view.state.doc.toString(), note);
    },
  );
  // Writable: Clear file properties edits. Add file property and Add alias
  // open the sheet, which needs a DOM; their writable runs are checked
  // through `PropertyEditing` above.
  await withFeatures(
    ["properties"],
    { doc: note, readOnly: false },
    async (f) => {
      assert.equal(await run(f, "markdown:clear-metadata-properties"), true);
      assert.equal(f.view.state.doc.toString(), "alpha");
    },
  );
});
