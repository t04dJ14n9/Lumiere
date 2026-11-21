import test from "node:test";
import assert from "node:assert/strict";
import {
  MARKDOWN_EDITOR,
  type HostServices,
  type SourceEdit,
} from "@workshop/markdown/portable";
import { ContextKeys } from "../../src/host/context-menu";
import {
  NoteDocuments,
  type NoteDocument,
  type NoteFiles,
} from "../../src/host/documents";
import { registerHistoryCommands } from "../../src/host/history-commands";
import { NoteHistory } from "../../src/host/note-history";
import { PanelHub } from "../../src/host/panels";
import { createHostCommands } from "../../src/host/services";
import { Session } from "../../../markdown/src/plugins/document/session";
import { protocol } from "../../../markdown/src/plugins/document/protocol";
import { rpcPair } from "../../../markdown/test/support/rpc-pair";

const NOTE = "file:///vault/Note.md";
const OTHER = "file:///vault/Other.md";

/**
 * Notes in memory, each with a watch the test fires itself: another
 * program's write is `writeOutside`, and nothing else touches the files.
 */
function memoryFiles(initial: Record<string, string>) {
  const disk = new Map(Object.entries(initial));
  const watchers = new Map<string, Set<() => void>>();
  const files: NoteFiles = {
    readText: async (uri) => {
      const text = disk.get(uri);
      if (text === undefined) {
        throw new Error(`No file ${uri}`);
      }
      return text;
    },
    save: async (uri, text) => {
      disk.set(uri, text);
    },
    create: async (uri) => {
      if (disk.has(uri)) {
        return false;
      }
      disk.set(uri, "");
      return true;
    },
    watch: (uri, listener) => {
      const set = watchers.get(uri) ?? new Set();
      set.add(listener);
      watchers.set(uri, set);
      return () => set.delete(listener);
    },
    sha256: (text) => text,
  };
  return {
    files,
    disk,
    async writeOutside(uri: string, text: string) {
      disk.set(uri, text);
      for (const watcher of watchers.get(uri) ?? []) {
        watcher();
      }
      await settle();
    },
  };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 10; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function openNote(initial: string) {
  const memory = memoryFiles({ [NOTE]: initial });
  const documents = new NoteDocuments(memory.files, 60_000);
  const note = await documents.open(NOTE);
  const changes: (readonly SourceEdit[] | undefined)[] = [];
  documents.onChange((_document, edits) => changes.push(edits));
  return { memory, documents, note, changes };
}

/** Insert `text` at `at`, as a page's push of one keystroke does. */
function type(
  documents: NoteDocuments,
  note: NoteDocument,
  at: number,
  text: string,
) {
  return documents.apply(note, [{ from: at, to: at, insert: text }]);
}

test("a step's edits are trimmed to what they change and taken back exactly", () => {
  const history = new NoteHistory();
  const before = "one two three";
  // Last first, each in the offsets of the text before both.
  const edits = [
    { from: 8, to: 13, insert: "THREE!" },
    { from: 0, to: 3, insert: "1" },
  ];
  history.record(before, edits);
  const after = "1 two THREE!";
  const undo = history.undo()!;
  assert.deepEqual(undo, [
    { from: 6, to: 12, insert: "three" },
    { from: 0, to: 1, insert: "one" },
  ]);
  assert.equal(applyEdits(after, undo), before);
  assert.equal(applyEdits(before, history.redo()!), after);
  assert.equal(history.redo(), undefined);
});

test("a whole-text replacement keeps only the changed part, never half a surrogate pair", () => {
  const history = new NoteHistory();
  const before = "a 😀 b";
  history.record(before, [{ from: 0, to: before.length, insert: "a 😃 b" }]);
  const undo = history.undo()!;
  assert.deepEqual(undo, [{ from: 2, to: 4, insert: "😀" }]);
  assert.equal(applyEdits("a 😃 b", undo), before);
});

test("edits that change nothing make no step", () => {
  const history = new NoteHistory();
  history.record("same", [{ from: 0, to: 4, insert: "same" }]);
  assert.equal(history.undo(), undefined);
});

test("typing is undone and redone one push at a time, and the pages hear it", async (t) => {
  const { documents, note, changes } = await openNote("note");
  t.after(() => documents.dispose());
  await type(documents, note, 4, " a");
  await type(documents, note, 6, "b");
  changes.length = 0;

  assert.equal(documents.undoOrRedo(note, "undo"), true);
  assert.equal(note.getText(), "note a");
  assert.equal(documents.undoOrRedo(note, "undo"), true);
  assert.equal(note.getText(), "note");
  assert.equal(note.isDirty, false);
  assert.equal(note.version, 5);
  assert.equal(documents.undoOrRedo(note, "undo"), false);

  assert.equal(documents.undoOrRedo(note, "redo"), true);
  assert.equal(note.getText(), "note a");
  assert.equal(note.isDirty, true);
  assert.deepEqual(changes, [
    [{ from: 6, to: 7, insert: "" }],
    [{ from: 4, to: 6, insert: "" }],
    [{ from: 4, to: 4, insert: " a" }],
  ]);

  // Typing after an undo leaves nothing to redo, as in VS Code.
  await type(documents, note, 6, "c");
  assert.equal(documents.undoOrRedo(note, "redo"), false);
  assert.equal(note.getText(), "note ac");
});

test("undo works across a save: back to the saved text is saved, past it is not", async (t) => {
  const { memory, documents, note } = await openNote("");
  t.after(() => documents.dispose());
  await type(documents, note, 0, "a");
  assert.equal(await note.save(), true);
  assert.equal(memory.disk.get(NOTE), "a");
  await type(documents, note, 1, "b");

  documents.undoOrRedo(note, "undo");
  assert.equal(note.getText(), "a");
  assert.equal(note.isDirty, false);
  documents.undoOrRedo(note, "undo");
  assert.equal(note.getText(), "");
  assert.equal(note.isDirty, true);
  documents.undoOrRedo(note, "redo");
  assert.equal(note.getText(), "a");
  assert.equal(note.isDirty, false);
  // What an undo leaves is written like typing.
  documents.undoOrRedo(note, "undo");
  assert.equal(await note.save(), true);
  assert.equal(memory.disk.get(NOTE), "");
});

test("another program's change to a clean note is one step: undo takes it back, then the typing before it", async (t) => {
  const { memory, documents, note } = await openNote("one\ntwo");
  t.after(() => documents.dispose());
  await type(documents, note, 7, "!");
  assert.equal(await note.save(), true);
  await memory.writeOutside(NOTE, "one\ntwo!\nthree");
  assert.equal(note.getText(), "one\ntwo!\nthree");
  assert.equal(note.isDirty, false);

  documents.undoOrRedo(note, "undo");
  assert.equal(note.getText(), "one\ntwo!");
  // The file still has the other program's text until the pause writes this.
  assert.equal(note.isDirty, true);
  documents.undoOrRedo(note, "undo");
  assert.equal(note.getText(), "one\ntwo");
  documents.undoOrRedo(note, "redo");
  documents.undoOrRedo(note, "redo");
  assert.equal(note.getText(), "one\ntwo!\nthree");
  assert.equal(note.isDirty, false);
});

test("another program's change merged into unsaved typing is one step, and the typing stays when it is undone", async (t) => {
  const { memory, documents, note } = await openNote("a\nb\nc");
  t.after(() => documents.dispose());
  await documents.apply(note, [{ from: 0, to: 1, insert: "A" }]);
  await memory.writeOutside(NOTE, "a\nb\nC");
  assert.equal(note.getText(), "A\nb\nC");

  documents.undoOrRedo(note, "undo");
  assert.equal(note.getText(), "A\nb\nc");
  documents.undoOrRedo(note, "undo");
  assert.equal(note.getText(), "a\nb\nc");
  documents.undoOrRedo(note, "redo");
  documents.undoOrRedo(note, "redo");
  assert.equal(note.getText(), "A\nb\nC");
});

test("the note's undo groups line up with its steps: a run of typing undoes at once", async (t) => {
  const { documents, note } = await openNote("x");
  t.after(() => documents.dispose());
  const commands = createHostCommands(() => {}, new ContextKeys());
  // Undo runs on the active page's note; here the session's note is it.
  registerHistoryCommands(
    commands,
    { active: () => ({ document: note }) } as never,
    documents,
  );
  const host = {
    hostDocuments: documents,
    hostCommands: commands,
  } as unknown as HostServices;
  const session = new Session(note, host);
  documents.onChange(() => session.changed());
  const pair = rpcPair();
  t.after(() => pair.dispose());
  await session.attach("A", pair.host);
  const push = (changes: unknown[], group: string) =>
    pair.client.call(protocol, "push", {
      version: session.version,
      changes: [changes],
      group,
    });

  // "ab" typed as two pushes of one input group, then "c" in the next one.
  await push([1, [0, "a"]], "input-1");
  await push([2, [0, "b"]], "input-1");
  await push([3, [0, "c"]], "input-2");
  assert.equal(note.getText(), "xabc");

  await session.history("undo");
  assert.equal(note.getText(), "xab");
  await session.history("undo");
  assert.equal(note.getText(), "x");
  assert.equal(session.text, "x");
  await session.history("redo");
  assert.equal(note.getText(), "xab");
});

test("undo on two pages of two notes acts on the active page's note only", async (t) => {
  const memory = memoryFiles({ [NOTE]: "first", [OTHER]: "second" });
  const documents = new NoteDocuments(memory.files, 60_000);
  const hub = new PanelHub(documents);
  hub.register(MARKDOWN_EDITOR, (shell) => shell.setHTML("<html></html>"));
  t.after(async () => {
    hub.dispose();
    await documents.dispose();
  });
  const commands = createHostCommands(() => {}, new ContextKeys());
  registerHistoryCommands(commands, hub, documents);
  const urls = () => ({
    cspSource: "'self'",
    asset: (relative: string) => relative,
    resource: (uri: string) => uri,
  });
  const first = await hub.open({ uri: NOTE, urls });
  const second = await hub.open({ uri: OTHER, urls });
  const note = hub.get(first.id)!.document;
  const other = hub.get(second.id)!.document;
  await type(documents, note, 5, " one");
  await type(documents, other, 6, " two");

  hub.activate(second.id);
  await commands.execute("undo");
  assert.equal(other.getText(), "second");
  assert.equal(note.getText(), "first one");

  hub.activate(first.id);
  await commands.execute("undo");
  assert.equal(note.getText(), "first");
  await commands.execute("redo");
  assert.equal(note.getText(), "first one");
  assert.equal(other.getText(), "second");

  // With no page active, nothing is undone.
  hub.activate(undefined);
  assert.equal(await commands.execute("undo"), false);
  assert.equal(note.getText(), "first one");
});

function applyEdits(text: string, edits: readonly SourceEdit[]): string {
  let result = text;
  for (const edit of edits) {
    result = result.slice(0, edit.from) + edit.insert + result.slice(edit.to);
  }
  return result;
}
