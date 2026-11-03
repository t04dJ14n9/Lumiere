import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { InputGroups } from "./input-groups";
import { editGroup } from "./input-annotation";

test("plain input grouping follows adjacency, timing and selection boundaries", () => {
  const groups = new InputGroups();
  groups.attach({
    hasFocus: true,
    dom: { addEventListener() {} },
  } as unknown as EditorView);
  let state = EditorState.create({ doc: "", extensions: groups.extension });
  const insert = (text: string, time: number) => {
    const transaction = state.update({
      changes: { from: state.doc.length, insert: text },
      userEvent: "input.type",
      annotations: Transaction.time.of(time),
    });
    state = transaction.state;
    return transaction.annotation(editGroup);
  };
  const first = insert("a", 0);
  assert.ok(first);
  assert.equal(insert("b", 100), first);
  const paused = insert("c", 1000);
  assert.notEqual(paused, first);
  state = state.update({ selection: { anchor: 1 } }).state;
  assert.notEqual(insert("d", 1100), paused);
  groups.dispose();
});

test("explicit and remote edits end plain-input groups without overriding their annotations", () => {
  const groups = new InputGroups();
  groups.attach({
    hasFocus: true,
    dom: { addEventListener() {} },
  } as unknown as EditorView);
  let state = EditorState.create({ doc: "", extensions: groups.extension });
  const first = state.update({
    changes: { from: 0, insert: "a" },
    annotations: Transaction.time.of(0),
    userEvent: "input.type",
  });
  state = first.state;
  const explicit = state.update({
    changes: { from: 1, insert: "b" },
    annotations: editGroup.of("table-command"),
  });
  assert.equal(explicit.annotation(editGroup), "table-command");
  const remote = explicit.state.update({
    changes: { from: 2, insert: "c" },
    annotations: Transaction.remote.of(true),
  });
  assert.equal(remote.annotation(editGroup), undefined);
  const next = remote.state.update({
    changes: { from: 3, insert: "d" },
    annotations: Transaction.time.of(100),
    userEvent: "input.type",
  });
  assert.notEqual(next.annotation(editGroup), first.annotation(editGroup));
  groups.dispose();
});

test("Vim insert session stays one group across a pause until a normal-mode boundary", () => {
  let mode: { insertMode?: boolean } | undefined = { insertMode: true };
  const groups = new InputGroups(() => mode);
  const listeners: Record<string, ((event: { key: string }) => void)[]> = {};
  groups.attach({
    hasFocus: true,
    dom: {
      addEventListener(
        type: string,
        listener: (event: { key: string }) => void,
      ) {
        (listeners[type] ??= []).push(listener);
      },
    },
  } as unknown as EditorView);
  let state = EditorState.create({ doc: "", extensions: groups.extension });
  const insert = (text: string, time: number) => {
    const transaction = state.update({
      changes: { from: state.doc.length, insert: text },
      userEvent: "input.type",
      annotations: Transaction.time.of(time),
    });
    state = transaction.state;
    return transaction.annotation(editGroup);
  };
  const first = insert("a", 0);
  assert.equal(first, "vim-0");
  // Pause longer than plain-input's 500ms window; Vim insert must keep the atom.
  assert.equal(insert("b", 1000), first);
  mode = { insertMode: false };
  for (const listener of listeners.keydown ?? []) {
    listener({ key: "u" });
  }
  assert.notEqual(insert("c", 1100), first);
  groups.dispose();
});

test("without vimMode, a pause splits plain input groups", () => {
  const groups = new InputGroups();
  groups.attach({
    hasFocus: true,
    dom: { addEventListener() {} },
  } as unknown as EditorView);
  let state = EditorState.create({ doc: "", extensions: groups.extension });
  const insert = (text: string, time: number) => {
    const transaction = state.update({
      changes: { from: state.doc.length, insert: text },
      userEvent: "input.type",
      annotations: Transaction.time.of(time),
    });
    state = transaction.state;
    return transaction.annotation(editGroup);
  };
  const first = insert("a", 0);
  assert.notEqual(insert("b", 1000), first);
  groups.dispose();
});

test("useVimMode unbind restores plain input-* groups across a pause", () => {
  const groups = new InputGroups();
  groups.attach({
    hasFocus: true,
    dom: { addEventListener() {} },
  } as unknown as EditorView);
  let state = EditorState.create({ doc: "", extensions: groups.extension });
  const insert = (text: string, time: number) => {
    const transaction = state.update({
      changes: { from: state.doc.length, insert: text },
      userEvent: "input.type",
      annotations: Transaction.time.of(time),
    });
    state = transaction.state;
    return transaction.annotation(editGroup);
  };

  groups.useVimMode(() => ({ insertMode: true }));
  const vimAtom = insert("a", 0);
  assert.equal(vimAtom, "vim-0");
  assert.equal(insert("b", 1000), vimAtom);

  // Fiber-stop cleanup: same call site as registerVimUndoGroups dispose.
  groups.useVimMode(() => undefined);
  const plainFirst = insert("c", 2000);
  assert.ok(plainFirst?.startsWith("input-"));
  const plainPaused = insert("d", 3000);
  assert.ok(plainPaused?.startsWith("input-"));
  assert.notEqual(plainPaused, plainFirst);
  groups.dispose();
});
