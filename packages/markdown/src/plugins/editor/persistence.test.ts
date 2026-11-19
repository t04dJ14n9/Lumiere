import assert from "node:assert/strict";
import test from "node:test";
import {
  EditorState,
  StateEffect,
  type TransactionSpec,
} from "@codemirror/state";
import { backgroundUpdate } from "./api";
import { hasPersistedEffects, savesViewState } from "./persistence";

const folded = StateEffect.define<null>();

function update(spec: TransactionSpec) {
  const startState = EditorState.create({ doc: "note" });
  const transaction = startState.update(spec);
  return { startState, state: transaction.state, transactions: [transaction] };
}

test("view state is saved for effects, but not for background work", () => {
  assert.equal(hasPersistedEffects(update({ effects: folded.of(null) })), true);
  assert.equal(
    hasPersistedEffects(
      update({
        effects: folded.of(null),
        annotations: backgroundUpdate.of(true),
      }),
    ),
    false,
  );
  assert.equal(hasPersistedEffects(update({})), false);
});

test("a caret move or an edit is saved through the checkpoint, like a fold", () => {
  const moved = update({ selection: { anchor: 2 } });
  assert.equal(
    savesViewState({ ...moved, selectionSet: true, docChanged: false }),
    true,
  );
  const typed = update({ changes: { from: 0, insert: "x" } });
  assert.equal(
    savesViewState({ ...typed, selectionSet: false, docChanged: true }),
    true,
  );
  assert.equal(
    savesViewState({ ...update({}), selectionSet: false, docChanged: false }),
    false,
  );
});
