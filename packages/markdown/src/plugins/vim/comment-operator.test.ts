import assert from "node:assert/strict";
import test from "node:test";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { CodeMirror, Vim } from "@replit/codemirror-vim";
import { dropCommentOperator } from "./comment-operator";

function commentCommandsAfter(keys: readonly string[]): string[] {
  let state = EditorState.create({ doc: "one\ntwo" });
  const view = {
    get state() {
      return state;
    },
    contentDOM: new EventTarget(),
    dispatch(...specs: TransactionSpec[]) {
      state = state.update(...specs).state;
    },
  } as unknown as EditorView;
  const cm = new CodeMirror(view);
  Vim.maybeInitVimState_(cm);
  const commands: string[] = [];
  cm.execCommand = (name: string) => {
    commands.push(name);
  };
  for (const key of keys) {
    Vim.handleKey(cm, key, "api");
  }
  return commands;
}

test("gc toggles no comment, as in Obsidian's Vim; stopping restores the library's", () => {
  assert.deepEqual(commentCommandsAfter(["g", "c", "c"]), [
    "toggleLineComment",
  ]);
  const restore = dropCommentOperator();
  try {
    assert.deepEqual(commentCommandsAfter(["g", "c", "c"]), []);
  } finally {
    restore();
  }
  assert.deepEqual(commentCommandsAfter(["g", "c", "c"]), [
    "toggleLineComment",
  ]);
});
