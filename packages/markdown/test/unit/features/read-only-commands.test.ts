import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, StateEffect } from "@codemirror/state";
import type { Plugin } from "@workshop/core";
import { calloutsWebview } from "../../../src/plugins/callouts/webview";
import { embedsWebview } from "../../../src/plugins/embeds/webview";
import { linksWebview } from "../../../src/plugins/links/webview";
import { mathWebview } from "../../../src/plugins/math/webview";
import { tasksWebview } from "../../../src/plugins/tasks/webview";
import { fixture } from "./fixture";

// CodeMirror's readOnly facet is advice to commands, not a filter on
// transactions: an editing command that does not check it edits the note
// anyway (#812). The formatting plugin's commands check it (their own
// tests); these are the other plugins' editing commands.
const EDITING_COMMANDS: [Plugin<unknown>, string[]][] = [
  [mathWebview, ["editor:insert-mathblock", "editor:toggle-inline-math"]],
  [linksWebview, ["editor:insert-wikilink"]],
  [embedsWebview, ["editor:insert-embed"]],
  [calloutsWebview, ["editor:insert-callout"]],
  [
    tasksWebview,
    ["editor:toggle-checklist-status", "editor:cycle-list-checklist"],
  ],
];

const DOC = "alpha";

/** Runs a plugin's registered command on `alpha`, the caret after it. */
async function runOnAlpha(
  plugin: Plugin<unknown>,
  id: string,
  readOnly: boolean,
): Promise<{ result: boolean; doc: string }> {
  const f = fixture();
  try {
    f.root.plugin(plugin);
    await f.root.settled();
    f.view.dispatch({
      changes: { from: 0, to: f.view.state.doc.length, insert: DOC },
      selection: { anchor: DOC.length },
      effects: StateEffect.appendConfig.of(EditorState.readOnly.of(readOnly)),
    });
    const run = f.handlers.get(id);
    assert.ok(run, `${id} is registered`);
    const result = await run();
    return { result, doc: f.view.state.doc.toString() };
  } finally {
    await f.root.dispose();
  }
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
