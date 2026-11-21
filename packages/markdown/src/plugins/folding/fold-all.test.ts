import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { foldService, foldState, foldedRanges } from "@codemirror/language";
import type { Context } from "@workshop/core";
import { foldRange, registerFoldAllCommands } from "./webview";

test("Fold All and Unfold All announce themselves before folding, for Properties", () => {
  const commands = new Map<string, () => boolean>();
  const order: string[] = [];
  const view = {
    state: EditorState.create({
      doc: "# A\na\n# B\nb",
      extensions: [
        foldState,
        foldService.of((state, from, to) =>
          foldRange(state, from, to, { heading: true, indent: true }),
        ),
      ],
    }),
    dispatch(spec: TransactionSpec) {
      order.push("fold");
      view.state = view.state.update(spec).state;
    },
  };
  const ctx = {
    editor: { view },
    effect: (setup: () => unknown) => setup(),
    commands: {
      register: (id: string, run: () => boolean) => commands.set(id, run),
    },
    emit: (name: string, command: string) => order.push(`${name} ${command}`),
  } as unknown as Context;
  registerFoldAllCommands(ctx);
  const folded = () => {
    let count = 0;
    foldedRanges(view.state).between(0, view.state.doc.length, () => {
      count++;
    });
    return count;
  };
  assert.equal(commands.get("editor:fold-all")!(), true);
  assert.equal(folded(), 2);
  commands.get("editor:unfold-all")!();
  assert.equal(folded(), 0);
  assert.deepEqual(order, [
    "folding/allCommand foldAll",
    "fold",
    "folding/allCommand unfoldAll",
    "fold",
  ]);
});
