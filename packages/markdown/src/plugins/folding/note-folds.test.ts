import test from "node:test";
import assert from "node:assert/strict";
import { foldEffect, foldState } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { FoldSaver, SAVE_DELAY_MS } from "./note-folds";
import type { SavedFold } from "./protocol";
import { changesFolds, foldedViewState } from "./view-state";

function harness(answer: () => boolean) {
  let folds: SavedFold[] = [];
  const sent: { folds: SavedFold[]; claim: boolean }[] = [];
  let timer: { ms: number; run: () => void } | undefined;
  const saver = new FoldSaver({
    capture: () => folds,
    async send(value, claim) {
      sent.push({ folds: value, claim });
      return answer();
    },
    after(ms, run) {
      timer = { ms, run };
      return () => {
        timer = undefined;
      };
    },
  });
  return {
    saver,
    sent,
    show(next: SavedFold[]) {
      folds = next;
    },
    /** Let the pending save run, and its answer arrive. */
    async elapse() {
      const pending = timer;
      timer = undefined;
      assert.equal(pending?.ms, SAVE_DELAY_MS);
      pending.run();
      await Promise.resolve();
      await Promise.resolve();
    },
    get isWaiting() {
      return timer !== undefined;
    },
  };
}

const fold = { from: 5, to: 16, edges: ["# One", "first body"] };

test("a fold is saved as the note's half a second later", async () => {
  const panel = harness(() => true);
  panel.show([fold]);
  panel.saver.folded();
  assert.deepEqual(panel.sent, []);
  await panel.elapse();
  assert.deepEqual(panel.sent, [{ folds: [fold], claim: true }]);
});

test("a text change sends the folds only when they moved", async () => {
  const panel = harness(() => true);
  panel.saver.textChanged();
  await panel.elapse();
  assert.deepEqual(panel.sent, [], "nothing moved: nothing is sent");
  const moved = { ...fold, from: 6, to: 17 };
  panel.show([moved]);
  panel.saver.textChanged();
  await panel.elapse();
  assert.deepEqual(panel.sent, [{ folds: [moved], claim: false }]);
});

test("once the note keeps another panel's folds, only a fold here sends again", async () => {
  let isWriter = false;
  const panel = harness(() => isWriter);
  panel.show([fold]);
  panel.saver.textChanged();
  await panel.elapse();
  assert.equal(panel.sent.length, 1, "turned down");
  panel.show([{ ...fold, from: 7, to: 18 }]);
  panel.saver.textChanged();
  assert.equal(panel.isWaiting, false);
  isWriter = true;
  panel.saver.folded();
  await panel.elapse();
  assert.deepEqual(panel.sent.at(-1)?.claim, true);
  panel.show([{ ...fold, from: 8, to: 19 }]);
  panel.saver.textChanged();
  assert.equal(panel.isWaiting, true);
});

test("closing the panel sends a save still waiting, and nothing else", async () => {
  const panel = harness(() => true);
  panel.saver.flush();
  assert.deepEqual(panel.sent, []);
  panel.show([fold]);
  panel.saver.folded();
  panel.saver.flush();
  assert.deepEqual(panel.sent, [{ folds: [fold], claim: true }]);
  assert.equal(panel.isWaiting, false);
});

test("folds put back from a save are not the reader's folds", () => {
  let state = EditorState.create({
    doc: "# One\nfirst body\n# Two\n",
    extensions: [foldState],
  });
  const transactions: Parameters<typeof changesFolds>[0][] = [];
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0]) {
      const transaction = state.update(spec);
      transactions.push(transaction);
      state = transaction.state;
    },
  } as unknown as EditorView;
  foldedViewState.restore(view, [{ from: 5, to: 16 }]);
  view.dispatch({ effects: foldEffect.of({ from: 5, to: 16 }) });
  view.dispatch({ changes: { from: 0, insert: "x" } });
  assert.deepEqual(transactions.map(changesFolds), [false, true, false]);
});
