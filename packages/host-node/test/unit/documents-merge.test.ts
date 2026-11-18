import test from "node:test";
import assert from "node:assert/strict";
import {
  NoteDocuments,
  type NoteDocument,
  type NoteFiles,
} from "../../src/host/documents";

const URI = "file:///vault/Note.md";

/**
 * One note's file in memory, with a watch the test fires itself: another
 * program's write is `writeOutside`, and nothing else touches the file.
 */
function memoryNote(initial: string) {
  let disk = initial;
  const watchers = new Set<() => void>();
  /** Files other than the note: its conflict copies. */
  const others = new Map<string, string>();
  const files: NoteFiles = {
    readText: async () => disk,
    save: async (uri, text) => {
      if (uri === URI) {
        disk = text;
      } else {
        others.set(uri, text);
      }
    },
    create: async (uri) => {
      if (uri === URI || others.has(uri)) {
        return false;
      }
      others.set(uri, "");
      return true;
    },
    watch: (_uri, listener) => {
      watchers.add(listener);
      return () => watchers.delete(listener);
    },
    sha256: (text) => text,
  };
  return {
    files,
    others,
    get disk() {
      return disk;
    },
    /** Another program rewrites the file and the platform reports it. */
    async writeOutside(text: string) {
      disk = text;
      for (const watcher of watchers) {
        watcher();
      }
      await settle();
    },
    /** The platform reports a write of ours coming back. */
    async echo() {
      for (const watcher of watchers) {
        watcher();
      }
      await settle();
    },
  };
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 5; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** Wait for an autosave: its delay is short, but a loaded machine is slow. */
async function until(done: () => boolean): Promise<void> {
  for (let waited = 0; !done(); waited += 5) {
    assert.ok(waited < 5_000, "timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await settle();
}

async function openNote(initial: string, delay = 60_000) {
  const file = memoryNote(initial);
  const documents = new NoteDocuments(file.files, delay);
  const note = await documents.open(URI);
  const changes: string[] = [];
  documents.onChange((document) => changes.push(document.getText()));
  return { file, documents, note, changes };
}

/** Types over the whole text, as a panel's edit does. */
function type(documents: NoteDocuments, note: NoteDocument, text: string) {
  return documents.apply(note, [
    { from: 0, to: note.getText().length, insert: text },
  ]);
}

test("an outside rewrite replaces a note with no unsaved typing", async (t) => {
  const { file, documents, note, changes } = await openNote("a\nb");
  t.after(() => documents.dispose());
  await file.writeOutside("a\nb\nc");
  assert.equal(note.getText(), "a\nb\nc");
  assert.equal(note.isDirty, false);
  assert.deepEqual(changes, ["a\nb\nc"]);
});

test("an outside rewrite that equals the unsaved text leaves it and ends the unsaved state", async (t) => {
  const { file, documents, note, changes } = await openNote("one\ntwo");
  t.after(() => documents.dispose());
  await type(documents, note, "one\nTWO");
  changes.length = 0;
  assert.equal(note.isDirty, true);
  await file.writeOutside("one\nTWO");
  assert.equal(note.getText(), "one\nTWO");
  assert.equal(note.isDirty, false);
  assert.deepEqual(changes, []);
});

test("an outside rewrite elsewhere merges into unsaved typing, and the merge is saved", async (t) => {
  const { file, documents, note, changes } = await openNote("a\nb\nc", 10);
  t.after(() => documents.dispose());
  await type(documents, note, "A\nb\nc");
  await file.writeOutside("a\nb\nC");
  assert.equal(note.getText(), "A\nb\nC");
  assert.deepEqual(changes.slice(1), ["A\nb\nC"]);
  assert.equal(note.isDirty, true);
  await until(() => file.disk === "A\nb\nC");
  assert.equal(note.isDirty, false);
});

test("an outside rewrite of the line being typed in keeps the typed line, and the outside version beside it", async (t) => {
  const { file, documents, note } = await openNote("a\nb\nc", 10);
  t.after(() => documents.dispose());
  const conflicts: string[] = [];
  documents.onConflict((_uri, copy) => conflicts.push(copy));
  await type(documents, note, "a\nmine\nc");
  await file.writeOutside("a\ntheirs\nc");
  assert.equal(note.getText(), "a\nmine\nc");
  assert.equal(note.isDirty, true);
  await until(() => file.disk === "a\nmine\nc");
  assert.deepEqual(conflicts, ["file:///vault/Note%20(conflict).md"]);
  assert.equal(file.others.get(conflicts[0]!), "a\ntheirs\nc");
  assert.equal(note.isDirty, false);
});

test("a conflicting outside rewrite still merges its changes elsewhere when saved", async (t) => {
  const { file, documents, note } = await openNote("a\nb\nc\nd", 60_000);
  t.after(() => documents.dispose());
  await type(documents, note, "a\nmine\nc\nd");
  await file.writeOutside("a\ntheirs\nc\nD");
  assert.equal(await note.save(), true);
  assert.equal(file.disk, "a\nmine\nc\nD");
  assert.equal(note.getText(), "a\nmine\nc\nD");
  assert.equal(
    file.others.get("file:///vault/Note%20(conflict).md"),
    "a\ntheirs\nc\nD",
  );
});

test("the next outside rewrite merges against what the last one left on disk", async (t) => {
  const { file, documents, note } = await openNote("a\nb\nc");
  t.after(() => documents.dispose());
  await type(documents, note, "A\nb\nc");
  await file.writeOutside("a\nb\nC");
  await file.writeOutside("a\nB\nC");
  assert.equal(note.getText(), "A\nB\nC");
});

test("our own write coming back from the watch changes nothing", async (t) => {
  const { file, documents, note, changes } = await openNote("a\nb");
  t.after(() => documents.dispose());
  await type(documents, note, "a\nB");
  assert.equal(await note.save(), true);
  changes.length = 0;
  await file.echo();
  assert.equal(note.getText(), "a\nB");
  assert.equal(note.isDirty, false);
  assert.deepEqual(changes, []);
});

test("typing during an outside rewrite is merged, not replaced, when the read returns", async (t) => {
  const file = memoryNote("a\nb\nc");
  let release: (() => void) | undefined;
  let reads = 0;
  const documents = new NoteDocuments(
    {
      ...file.files,
      readText: async (uri) => {
        reads += 1;
        // The reload after the open waits until the user has typed; later
        // reads (the save on dispose checks the disk) do not.
        if (reads === 2) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return file.files.readText(uri);
      },
    },
    60_000,
  );
  t.after(() => documents.dispose());
  const note = await documents.open(URI);
  const outside = file.writeOutside("a\nb\nC");
  await settle();
  await type(documents, note, "A\nb\nc");
  release!();
  await outside;
  await settle();
  assert.equal(note.getText(), "A\nb\nC");
});
