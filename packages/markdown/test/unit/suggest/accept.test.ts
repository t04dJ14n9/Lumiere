import test from "node:test";
import assert from "node:assert/strict";
import { history, undo } from "@codemirror/commands";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import {
  acceptSuggestion,
  type AcceptView,
  type BlockId,
  type BlockIdHost,
} from "../../../src/plugins/suggest/accept";
import { completionEdit } from "../../../src/plugins/suggest/completion";
import { linkSuggestion } from "../../../src/plugins/links/suggestions";

const OTHER: BlockId = {
  uri: "file:///vault/Note.md",
  at: 12,
  before: "A body",
  insert: " ^abc123",
  here: false,
};

function editor(doc: string): AcceptView & { state: EditorState } {
  const view = {
    state: EditorState.create({ doc, extensions: [history()] }),
    dispatch(spec: TransactionSpec) {
      view.state = view.state.update(spec).state;
    },
  };
  return view;
}

/** A host whose `write` settles when the test says so. */
function hostWith(written: boolean | Error) {
  const calls = { write: 0, changed: 0, warned: [] as unknown[] };
  let settle: () => void = () => {};
  const settled = new Promise<void>((resolve) => (settle = resolve));
  const host: BlockIdHost = {
    write: async () => {
      calls.write++;
      await settled;
      if (written instanceof Error) {
        throw written;
      }
      return written;
    },
    changed: () => calls.changed++,
    warn: (_message, error) => calls.warned.push(error),
  };
  const finish = async () => {
    settle();
    for (let turn = 0; turn < 5; turn++) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  return { host, calls, finish };
}

/** Accepts what `typed` offers as `insert`, the way the editor does. */
function acceptTyped(
  typed: string,
  insert: string,
  options: { blockId?: BlockId; written: boolean | Error; tab?: boolean },
) {
  const view = editor(typed);
  const trigger = linkSuggestion({ state: view.state, pos: typed.length })!;
  const edit = completionEdit(
    view.state,
    { from: trigger.from, to: typed.length },
    insert,
    { close: !options.tab && trigger.closeLink },
  );
  const { host, calls, finish } = hostWith(options.written);
  acceptSuggestion({ view, edit, blockId: options.blockId, host });
  return { view, calls, finish };
}

test("a block id the host could not write leaves the link to the note, not to the block", async () => {
  for (const [typed, insert, linked, expected] of [
    ["[[Note#^ab", "abc123", "[[Note#^abc123]]", "[[Note]]"],
    ["[[Note^ab", "#^abc123", "[[Note#^abc123]]", "[[Note]]"],
    ["[[^^ab", "Note#^abc123", "[[Note#^abc123]]", "[[Note]]"],
  ] as const) {
    const { view, calls, finish } = acceptTyped(typed, insert, {
      blockId: OTHER,
      written: false,
    });
    assert.equal(view.state.doc.toString(), linked, typed);
    await finish();
    assert.equal(calls.write, 1);
    assert.equal(view.state.doc.toString(), expected, typed);
  }
});

test("the same holds for a Markdown link and for Tab, which leaves the link open", async () => {
  const markdown = editor("[[Note#^ab");
  const { host, finish } = hostWith(false);
  acceptSuggestion({
    view: markdown,
    edit: {
      changes: { from: 0, to: 10, insert: "[A body](Note.md#^abc123)" },
      selection: { anchor: 25 },
    },
    blockId: OTHER,
    host,
  });
  await finish();
  assert.equal(markdown.state.doc.toString(), "[A body](Note.md)");

  const tab = acceptTyped("[[Note#^ab", "abc123", {
    blockId: OTHER,
    written: false,
    tab: true,
  });
  assert.equal(tab.view.state.doc.toString(), "[[Note#^abc123");
  await tab.finish();
  assert.equal(tab.view.state.doc.toString(), "[[Note");
});

test("a write that fails outright is the same as one the host refused, and is logged", async () => {
  const failure = new Error("timed out");
  const { view, calls, finish } = acceptTyped("[[Note#^ab", "abc123", {
    blockId: OTHER,
    written: failure,
  });
  await finish();
  assert.equal(view.state.doc.toString(), "[[Note]]");
  assert.deepEqual(calls.warned, [failure]);
});

test("the repair finds the link where typing has moved it, and leaves an edited one alone", async () => {
  const moved = acceptTyped("[[Note#^ab", "abc123", {
    blockId: OTHER,
    written: false,
  });
  moved.view.dispatch({ changes: { from: 0, insert: "See " } });
  await moved.finish();
  assert.equal(moved.view.state.doc.toString(), "See [[Note]]");

  const edited = acceptTyped("[[Note#^ab", "abc123", {
    blockId: OTHER,
    written: false,
  });
  edited.view.dispatch({ changes: { from: 6, to: 15, insert: "" } });
  const before = edited.view.state.doc.toString();
  await edited.finish();
  assert.equal(edited.view.state.doc.toString(), before);
});

test("undoing the repair and the pick restores the typed text", async () => {
  const { view, finish } = acceptTyped("[[Note#^ab", "abc123", {
    blockId: OTHER,
    written: false,
  });
  await finish();
  assert.equal(view.state.doc.toString(), "[[Note]]");
  while (undo(view)) {
    // Each undo is one step; the typed text is all that is left at the end.
  }
  assert.equal(view.state.doc.toString(), "[[Note#^ab");
});

test("a block id the host wrote keeps the link as inserted", async () => {
  const { view, calls, finish } = acceptTyped("[[Note#^ab", "abc123", {
    blockId: OTHER,
    written: true,
  });
  await finish();
  assert.equal(calls.write, 1);
  assert.equal(view.state.doc.toString(), "[[Note#^abc123]]");
});

test("a suggestion without a block id is inserted as it is, with nothing asked of the host", async () => {
  const { view, calls, finish } = acceptTyped("[[No", "Note", {
    written: true,
  });
  await finish();
  assert.equal(view.state.doc.toString(), "[[Note]]");
  assert.equal(calls.write, 0);
});

const OWN = "A body\n\nSee [[#^ab";
const OWN_ID: BlockId = {
  uri: "file:///vault/Home.md",
  at: 6,
  before: "A body",
  insert: " ^abc123",
  here: true,
};

test("a block of this note gets its id in the same edit as the link", async () => {
  const { view, calls, finish } = acceptTyped(OWN, "abc123", {
    blockId: OWN_ID,
    written: true,
  });
  await finish();
  assert.equal(view.state.doc.toString(), "A body ^abc123\n\nSee [[#^abc123]]");
  assert.deepEqual(calls, { write: 0, changed: 0, warned: [] });
});

test("a block of this note that changed first gets no link, and the host says why", async () => {
  const stale = { ...OWN_ID, before: "A bod" + "x" };
  const { view, calls, finish } = acceptTyped(OWN, "abc123", {
    blockId: stale,
    written: true,
  });
  await finish();
  assert.equal(view.state.doc.toString(), OWN);
  assert.deepEqual(calls, { write: 0, changed: 1, warned: [] });
});
