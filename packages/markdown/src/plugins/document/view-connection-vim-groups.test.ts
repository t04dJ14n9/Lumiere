import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, Transaction } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { ViewConnection } from "./view-connection";
import { editGroup } from "./input-annotation";
import type { Endpoint } from "../../shared/rpc/endpoint";

test("ViewConnection.useVimMode makes main-editor inserts one Vim undo atom across a pause", () => {
  const connection = new ViewConnection(
    { version: 0, clientID: "test" },
    {} as Endpoint,
    () => {},
  );
  assert.equal(typeof connection.useVimMode, "function");
  let mode: { insertMode?: boolean } | undefined = { insertMode: true };
  connection.useVimMode(() => mode);

  const listeners: Record<string, ((event: { key: string }) => void)[]> = {};
  const view = {
    hasFocus: true,
    dom: {
      addEventListener(
        type: string,
        listener: (event: { key: string }) => void,
      ) {
        (listeners[type] ??= []).push(listener);
      },
      setAttribute() {},
    },
    composing: false,
  } as unknown as EditorView;
  connection.attach(view);

  let state = EditorState.create({
    doc: "",
    extensions: connection.extension,
  });
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
  assert.ok(first?.startsWith("vim-"));
  assert.equal(insert("b", 1000), first);
  mode = { insertMode: false };
  for (const listener of listeners.keydown ?? []) {
    listener({ key: "u" });
  }
  assert.notEqual(insert("c", 1100), first);
  connection.dispose();
});

test("ViewConnection.useVimMode unbind restores plain input-* groups across a pause", () => {
  const connection = new ViewConnection(
    { version: 0, clientID: "test" },
    {} as Endpoint,
    () => {},
  );
  const view = {
    hasFocus: true,
    dom: {
      addEventListener() {},
      setAttribute() {},
    },
    composing: false,
  } as unknown as EditorView;
  connection.attach(view);

  let state = EditorState.create({
    doc: "",
    extensions: connection.extension,
  });
  const insert = (text: string, time: number) => {
    const transaction = state.update({
      changes: { from: state.doc.length, insert: text },
      userEvent: "input.type",
      annotations: Transaction.time.of(time),
    });
    state = transaction.state;
    return transaction.annotation(editGroup);
  };

  connection.useVimMode(() => ({ insertMode: true }));
  const vimAtom = insert("a", 0);
  assert.ok(vimAtom?.startsWith("vim-"));
  assert.equal(insert("b", 1000), vimAtom);

  connection.useVimMode(() => undefined);
  const plainFirst = insert("c", 2000);
  assert.ok(plainFirst?.startsWith("input-"));
  const plainPaused = insert("d", 3000);
  assert.ok(plainPaused?.startsWith("input-"));
  assert.notEqual(plainPaused, plainFirst);
  connection.dispose();
});
