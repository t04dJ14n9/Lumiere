import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
  diskReadChangesNote,
  NoteDocuments,
  noteFiles,
} from "../../src/host/documents";
import { createNodePlatform } from "../../src/host/node-platform";
import {
  Autosave,
  AUTOSAVE_DELAY_MS,
} from "../../../markdown/src/plugins/document/autosave";

/** Notes on Node's file system, as the Node host keeps them. */
const NODE_NOTES = noteFiles(
  createNodePlatform({ data: tmpdir(), workers: "" }),
);

async function note(text: string) {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-host-"));
  const file = path.join(dir, "Note.md");
  await writeFile(file, text);
  return {
    file,
    uri: pathToFileURL(file).toString(),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

const until = async (check: () => Promise<boolean> | boolean) => {
  for (let i = 0; i < 100; i++) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("condition never held");
};

test("edits apply in LF offsets over CRLF text, report source offsets and write after a pause", async (t) => {
  const { file, uri, cleanup } = await note("a\r\nb\r\nc");
  const documents = new NoteDocuments(NODE_NOTES, 10);
  t.after(() => documents.dispose());
  t.after(cleanup);
  const document = await documents.open(uri);
  const changes: unknown[] = [];
  documents.onChange((_document, edits) => changes.push(edits));

  // "b" is offset 2 in the LF text and 3 in the CRLF source.
  assert.equal(
    await documents.apply(document, [
      { from: 2, to: 3, insert: "B" },
      { from: 0, to: 1, insert: "A" },
    ]),
    true,
  );
  assert.equal(document.getText(), "A\r\nB\r\nc");
  assert.equal(document.version, 2);
  assert.equal(document.isDirty, true);
  assert.deepEqual(changes, [
    [
      { from: 3, to: 4, insert: "B" },
      { from: 0, to: 1, insert: "A" },
    ],
  ]);
  await until(async () => (await readFile(file, "utf8")) === "A\r\nB\r\nc");
  assert.equal(document.isDirty, false);
});

test("pending edits flush before a save writes, and save listeners hear it", async (t) => {
  const { file, uri, cleanup } = await note("one");
  const documents = new NoteDocuments(NODE_NOTES, 60_000);
  t.after(() => documents.dispose());
  t.after(cleanup);
  const document = await documents.open(uri);
  documents.onWillSave(async (saving) => {
    await documents.apply(saving, [{ from: 3, to: 3, insert: " two" }]);
  });
  const saved: string[] = [];
  documents.onSave((item) => saved.push(item.getText()));
  assert.equal(await document.save(), true);
  assert.equal(await readFile(file, "utf8"), "one two");
  assert.deepEqual(saved, ["one two"]);
});

test("a page that cannot flush before a save (composing, busy) does not fail the save", async (t) => {
  const { file, uri, cleanup } = await note("one");
  const logged: string[] = [];
  const documents = new NoteDocuments(NODE_NOTES, 60_000, (message) =>
    logged.push(message),
  );
  t.after(() => documents.dispose());
  t.after(cleanup);
  const document = await documents.open(uri);
  const failed: string[] = [];
  documents.onSaveFailed((item) => failed.push(item));
  documents.onWillSave(async () => {
    throw new Error("flush timed out after 1200ms");
  });
  await documents.apply(document, [{ from: 3, to: 3, insert: " two" }]);
  assert.equal(await document.save(), true);
  assert.equal(await readFile(file, "utf8"), "one two");
  assert.equal(document.isDirty, false);
  assert.deepEqual(failed, []);
  assert.match(logged.join(" "), /flush timed out/);
});

test("another program's change reloads a clean note, and where both changed the same line unsaved typing stays", async (t) => {
  const { file, uri, cleanup } = await note("start");
  const documents = new NoteDocuments(NODE_NOTES, 60_000);
  t.after(() => documents.dispose());
  t.after(cleanup);
  const document = await documents.open(uri);
  await writeFile(file, "from outside");
  await until(() => document.getText() === "from outside");
  assert.equal(document.isDirty, false);

  await documents.apply(document, [{ from: 0, to: 0, insert: "mine: " }]);
  await writeFile(file, "outside again");
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(document.getText(), "mine: from outside");
});

test("another program's change on a file watched from disk merges into unsaved typing and is not written over", async (t) => {
  const { file, uri, cleanup } = await note("a\nb\nc");
  const documents = new NoteDocuments(NODE_NOTES, 60_000);
  t.after(() => documents.dispose());
  t.after(cleanup);
  const document = await documents.open(uri);
  await documents.apply(document, [{ from: 0, to: 1, insert: "A" }]);
  await writeFile(file, "a\nb\nC");
  await until(() => document.getText() === "A\nb\nC");
  assert.equal(document.isDirty, true);
  assert.equal(await document.save(), true);
  assert.equal(await readFile(file, "utf8"), "A\nb\nC");
});

test("the last panel to let go writes unsaved text and closes the note", async (t) => {
  const { file, uri, cleanup } = await note("x");
  const documents = new NoteDocuments(NODE_NOTES, 60_000);
  t.after(() => documents.dispose());
  t.after(cleanup);
  const closed: string[] = [];
  documents.onClosed((item) => closed.push(item));
  const document = await documents.open(uri);
  documents.retain(uri);
  documents.retain(uri);
  await documents.apply(document, [{ from: 1, to: 1, insert: "y" }]);
  await documents.release(uri);
  assert.deepEqual(closed, []);
  await documents.release(uri);
  assert.deepEqual(closed, [uri]);
  assert.equal(await readFile(file, "utf8"), "xy");
  assert.equal(documents.text(uri), undefined);
});

test("a failed write still closes every watch, so the host can exit", async (t) => {
  const { uri, cleanup } = await note("doomed");
  const documents = new NoteDocuments(NODE_NOTES, 60_000);
  const document = await documents.open(uri);
  await documents.apply(document, [{ from: 0, to: 0, insert: "!" }]);
  await cleanup();
  await assert.rejects(documents.dispose(), { code: "ENOENT" });
  assert.equal(documents.text(uri), undefined);
  t.diagnostic("the test process exiting proves no watch stayed open");
});

test("a disk read that overlapped a save does not undo it", () => {
  assert.equal(
    diskReadChangesNote({
      text: "stale",
      diskText: "edited",
      open: true,
      writesAtStart: 0,
      writesNow: 1,
      writing: false,
    }),
    false,
  );
  assert.equal(
    diskReadChangesNote({
      text: "from outside",
      diskText: "saved",
      open: true,
      writesAtStart: 1,
      writesNow: 1,
      writing: false,
    }),
    true,
  );
  assert.equal(
    diskReadChangesNote({
      text: "",
      diskText: "saved",
      open: true,
      writesAtStart: 1,
      writesNow: 1,
      writing: true,
    }),
    false,
    "a read made while a save was writing",
  );
});

test("a disk read in flight during a save is dropped when it resumes", async (t) => {
  const { file, uri, cleanup } = await note("saved");
  const pending: Array<(text: string) => void> = [];
  let opened = false;
  const documents = new NoteDocuments(
    {
      ...NODE_NOTES,
      // Only the reload's read is held; the save's own read of the disk
      // (whether another program changed it) goes through.
      readText: (target) => {
        if (!opened || pending.length > 0) {
          opened = true;
          return NODE_NOTES.readText(target);
        }
        return new Promise((resolve) => {
          pending.push(resolve);
        });
      },
    },
    60_000,
  );
  t.after(() => {
    for (const resolve of pending) {
      resolve("edited");
    }
    return documents.dispose();
  });
  t.after(cleanup);
  const document = await documents.open(uri);
  await writeFile(file, "external");
  await until(() => pending.length >= 1);
  await documents.apply(document, [{ from: 0, to: 5, insert: "edited" }]);
  assert.equal(await document.save(), true);
  pending[0]!("stale");
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(document.getText(), "edited");
  assert.equal(await readFile(file, "utf8"), "edited");
});

test("opening a note twice at once returns one document", async (t) => {
  const { uri, cleanup } = await note("same");
  const documents = new NoteDocuments(NODE_NOTES);
  t.after(() => documents.dispose());
  t.after(cleanup);
  const [a, b] = await Promise.all([documents.open(uri), documents.open(uri)]);
  assert.equal(a, b);
});

test("a note's files may be a class instance: its methods keep their object", async () => {
  const platform = createNodePlatform({ data: tmpdir(), workers: "" });
  class ClassFiles {
    constructor(private readonly prefix: string) {}
    async readText(uri: string): Promise<string> {
      return `${this.prefix}${uri}`;
    }
  }
  const notes = noteFiles({
    ...platform,
    files: Object.assign(new ClassFiles("read:"), {
      save: platform.files.save,
      watch: platform.files.watch,
    }) as never,
  });
  assert.equal(await notes.readText("file:///n.md"), "read:file:///n.md");
});

test("a save after typing pauses that fails is reported, and the text stays", async (t) => {
  const { uri, cleanup } = await note("start");
  t.after(cleanup);
  const documents = new NoteDocuments(
    {
      ...NODE_NOTES,
      save: async () => {
        throw new Error("The disk is full");
      },
    },
    10,
  );
  const failed: [string, string][] = [];
  documents.onSaveFailed((target, error) =>
    failed.push([target, (error as Error).message]),
  );
  const document = await documents.open(uri);
  await documents.apply(document, [{ from: 0, to: 5, insert: "typed" }]);
  await until(() => failed.length > 0);
  assert.deepEqual(failed, [[uri, "The disk is full"]]);
  assert.equal(document.getText(), "typed");
  assert.equal(document.isDirty, true);
  await documents.dispose().catch(() => {});
});

test("retaining a dirty note while release() is saving keeps the document open", async (t) => {
  const { uri, cleanup } = await note("initial");
  const documents = new NoteDocuments(NODE_NOTES, 60_000);
  t.after(() => documents.dispose());
  t.after(cleanup);

  let finishWillSave: (() => void) | undefined;
  documents.onWillSave(
    () =>
      new Promise<void>((resolve) => {
        finishWillSave = resolve;
      }),
  );

  const closed: string[] = [];
  documents.onClosed((item) => closed.push(item));

  const doc = await documents.open(uri);
  documents.retain(uri);
  await documents.apply(doc, [{ from: 0, to: 7, insert: "updated" }]);
  assert.equal(doc.isDirty, true);

  let released = false;
  const releasing = documents.release(uri).then(() => {
    released = true;
  });
  await until(() => finishWillSave !== undefined);

  documents.retain(uri);

  finishWillSave!();
  await releasing;
  assert.equal(released, true);
  assert.deepEqual(closed, []);
  assert.equal(documents.text(uri), "updated");
});

test("a save that failed does not block the next save of the note", async (t) => {
  const { file, uri, cleanup } = await note("start");
  t.after(cleanup);
  let diskFull = true;
  const documents = new NoteDocuments(
    {
      ...NODE_NOTES,
      save: async (target, text) => {
        if (diskFull) {
          throw new Error("The disk is full");
        }
        await NODE_NOTES.save(target, text);
      },
    },
    60_000,
  );
  t.after(() => documents.dispose());
  const document = await documents.open(uri);
  await documents.apply(document, [{ from: 0, to: 5, insert: "first" }]);
  await assert.rejects(document.save(), /The disk is full/);
  diskFull = false;
  await documents.apply(document, [{ from: 0, to: 5, insert: "again" }]);
  assert.equal(await document.save(), true);
  assert.equal(await readFile(file, "utf8"), "again");
});

test("a save that fails when the last panel closes is reported, and the text stays open", async (t) => {
  const { uri, cleanup } = await note("start");
  t.after(cleanup);
  let watchClosed = false;
  const documents = new NoteDocuments(
    {
      ...NODE_NOTES,
      save: async () => {
        throw new Error("The disk is full");
      },
      watch: (target, onChange) => {
        const stop = NODE_NOTES.watch(target, onChange);
        return () => {
          watchClosed = true;
          stop();
        };
      },
    },
    60_000,
  );
  const failed: [string, string][] = [];
  documents.onSaveFailed((target, error) =>
    failed.push([target, (error as Error).message]),
  );
  const document = await documents.open(uri);
  documents.retain(uri);
  await documents.apply(document, [{ from: 0, to: 5, insert: "typed" }]);
  await documents.release(uri);
  assert.deepEqual(failed, [[uri, "The disk is full"]]);
  assert.equal(documents.text(uri), "typed");
  assert.equal(watchClosed, false);
  await documents.dispose().catch(() => {});
  assert.equal(watchClosed, true);
});

test("a note reopened and released again while its first save writes is not forgotten when the second save fails", async (t) => {
  const { file, uri, cleanup } = await note("start");
  t.after(cleanup);
  let finishFirstWrite: (() => void) | undefined;
  let writes = 0;
  const documents = new NoteDocuments(
    {
      ...NODE_NOTES,
      save: async (target, text) => {
        writes += 1;
        if (writes === 1) {
          await new Promise<void>((resolve) => {
            finishFirstWrite = resolve;
          });
          await NODE_NOTES.save(target, text);
          return;
        }
        throw new Error("The disk is full");
      },
    },
    60_000,
  );
  const failed: string[] = [];
  documents.onSaveFailed((_target, error) =>
    failed.push((error as Error).message),
  );

  const first = await documents.open(uri);
  documents.retain(uri);
  await documents.apply(first, [{ from: 0, to: 5, insert: "B" }]);
  const firstRelease = documents.release(uri);
  await until(() => finishFirstWrite !== undefined);

  // The note is still in memory, so opening it again hands back the same one.
  const reopened = await documents.open(uri);
  documents.retain(uri);
  await documents.apply(reopened, [{ from: 0, to: 1, insert: "C" }]);
  const secondRelease = documents.release(uri);

  finishFirstWrite!();
  await Promise.all([firstRelease, secondRelease]);

  assert.deepEqual(failed, ["The disk is full"]);
  assert.equal(await readFile(file, "utf8"), "B");
  assert.equal(documents.text(uri), "C");
  await documents.dispose().catch(() => {});
});

test("unsaved typing saved over another program's change keeps that change beside the note", async (t) => {
  const { file, uri, cleanup } = await note("start");
  const documents = new NoteDocuments(NODE_NOTES, 60_000);
  t.after(cleanup);
  t.after(() => documents.dispose());
  const conflicts: [string, string][] = [];
  documents.onConflict((target, copy) => conflicts.push([target, copy]));
  const document = await documents.open(uri);
  await documents.apply(document, [{ from: 0, to: 0, insert: "mine: " }]);
  // While the note is dirty the reload skips this; the save must not lose it.
  await writeFile(file, "theirs");

  assert.equal(await document.save(), true);
  assert.equal(await readFile(file, "utf8"), "mine: start");
  const copy = path.join(path.dirname(file), "Note (conflict).md");
  assert.equal(await readFile(copy, "utf8"), "theirs");
  assert.deepEqual(conflicts, [[uri, pathToFileURL(copy).toString()]]);
  assert.equal(document.isDirty, false);

  // The next save is of text that knows the disk: no second copy.
  await documents.apply(document, [{ from: 0, to: 0, insert: "more " }]);
  assert.equal(await document.save(), true);
  assert.equal(conflicts.length, 1);
});

test("a save with nothing unsaved takes another program's change instead of writing over it", async (t) => {
  const { file, uri, cleanup } = await note("start");
  // No watch: the save finds the change before any reload would.
  const documents = new NoteDocuments(
    { ...NODE_NOTES, watch: () => () => {} },
    60_000,
  );
  t.after(cleanup);
  t.after(() => documents.dispose());
  const document = await documents.open(uri);
  await documents.apply(document, [{ from: 0, to: 0, insert: "x" }]);
  await documents.apply(document, [{ from: 0, to: 1, insert: "" }]);
  assert.equal(document.isDirty, false);
  await writeFile(file, "theirs");

  assert.equal(await document.save(), true);
  assert.equal(await readFile(file, "utf8"), "theirs");
  assert.equal(document.getText(), "theirs");
  assert.equal(document.isDirty, false);
});

test("a reload that reads the file while a save has emptied it does not empty the note", async (t) => {
  // Saves replace the file in place: it is empty between the truncation and
  // the write, and the truncation alone wakes the watch.
  let disk = "start";
  const watchers = new Set<() => void>();
  const documents = new NoteDocuments(
    {
      ...NODE_NOTES,
      readText: async () => disk,
      watch: (_uri, listener) => {
        watchers.add(listener);
        return () => watchers.delete(listener);
      },
      save: async (_uri, text) => {
        disk = "";
        for (const listener of watchers) {
          listener();
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
        disk = text;
      },
    },
    60_000,
  );
  t.after(() => documents.dispose());
  const document = await documents.open("file:///v/Note.md");
  // Typed and undone before the pause: the autosave writes a clean note.
  await documents.apply(document, [{ from: 0, to: 0, insert: "x" }]);
  await documents.apply(document, [{ from: 0, to: 1, insert: "" }]);
  assert.equal(await document.save(), true);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(document.getText(), "start");
  assert.equal(document.isDirty, false);
  assert.equal(disk, "start");
});

test("another program's change that lands during a save is read once the save is written", async (t) => {
  let disk = "start";
  const watchers = new Set<() => void>();
  const documents = new NoteDocuments(
    {
      ...NODE_NOTES,
      readText: async () => disk,
      watch: (_uri, listener) => {
        watchers.add(listener);
        return () => watchers.delete(listener);
      },
      save: async (_uri, text) => {
        disk = text;
        await new Promise((resolve) => setTimeout(resolve, 10));
        disk = "theirs";
        for (const listener of watchers) {
          listener();
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      },
    },
    60_000,
  );
  t.after(() => documents.dispose());
  const document = await documents.open("file:///v/Note.md");
  await documents.apply(document, [{ from: 5, to: 5, insert: "!" }]);
  assert.equal(await document.save(), true);
  await until(() => document.getText() === "theirs");
  assert.equal(document.isDirty, false);
});

test("typing during a save's disk read is kept when another program changed the note", async (t) => {
  const { file, uri, cleanup } = await note("start");
  let holdReads = false;
  const held: Array<() => void> = [];
  const documents = new NoteDocuments(
    {
      ...NODE_NOTES,
      watch: () => () => {},
      readText: async (target) => {
        if (holdReads) {
          await new Promise<void>((resolve) => held.push(resolve));
        }
        return NODE_NOTES.readText(target);
      },
    },
    60_000,
  );
  t.after(cleanup);
  t.after(() => documents.dispose());
  const conflicts: string[] = [];
  documents.onConflict((_target, copy) => conflicts.push(copy));
  const document = await documents.open(uri);
  await writeFile(file, "external");

  holdReads = true;
  const saved = document.save();
  await until(() => held.length === 1);
  holdReads = false;
  await documents.apply(document, [{ from: 0, to: 0, insert: "typed " }]);
  held[0]!();

  assert.equal(await saved, true);
  assert.equal(document.getText(), "typed start");
  assert.equal(await readFile(file, "utf8"), "typed start");
  assert.equal(conflicts.length, 1);
  const copy = path.join(path.dirname(file), "Note (conflict).md");
  assert.equal(await readFile(copy, "utf8"), "external");
});

test("a save that cannot read the file to check for another program's change does not write", async (t) => {
  const { file, uri, cleanup } = await note("start");
  let readable = true;
  const documents = new NoteDocuments(
    {
      ...NODE_NOTES,
      watch: () => () => {},
      readText: (target) =>
        readable
          ? NODE_NOTES.readText(target)
          : Promise.reject(
              Object.assign(new Error("EACCES: permission denied"), {
                code: "EACCES",
              }),
            ),
    },
    60_000,
  );
  t.after(cleanup);
  t.after(() => documents.dispose().catch(() => {}));
  const document = await documents.open(uri);
  await documents.apply(document, [{ from: 0, to: 0, insert: "mine: " }]);
  await writeFile(file, "theirs");
  readable = false;

  await assert.rejects(document.save(), /EACCES/);
  assert.equal(await readFile(file, "utf8"), "theirs");
  assert.equal(document.isDirty, true);
  assert.equal(document.getText(), "mine: start");
  readable = true;
});

test("the editor's autosave over another program's conflicting change keeps that change beside the note first", async (t) => {
  const { file, uri, cleanup } = await note("start");
  // No watch: the autosave's save finds the change, as when its event is late.
  const documents = new NoteDocuments(
    { ...NODE_NOTES, watch: () => () => {} },
    60_000,
  );
  t.after(cleanup);
  t.after(() => documents.dispose());
  const conflicts: string[] = [];
  documents.onConflict((_target, copy) => conflicts.push(copy));
  const document = await documents.open(uri);
  let saving: Promise<boolean> | undefined;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const autosave = new Autosave({
    document,
    settings: {
      forNote: () => ({
        preset: "minimal",
        mode: "source",
        editor: {
          useTabs: true,
          tabSize: 4,
          autosave: true,
          filesAutoSave: "off",
        },
      }),
    },
    save: () => (saving = document.save()),
    logger: { warn: () => {} } as never,
  });
  t.after(() => autosave.dispose());

  await documents.apply(document, [{ from: 0, to: 0, insert: "mine: " }]);
  autosave.edited();
  await writeFile(file, "theirs");
  t.mock.timers.tick(AUTOSAVE_DELAY_MS);

  assert.ok(saving, "the countdown saved the note");
  assert.equal(await saving, true);
  const copy = path.join(path.dirname(file), "Note (conflict).md");
  assert.equal(await readFile(copy, "utf8"), "theirs");
  assert.equal(await readFile(file, "utf8"), "mine: start");
  assert.deepEqual(conflicts, [pathToFileURL(copy).toString()]);
  assert.equal(document.isDirty, false);
});
