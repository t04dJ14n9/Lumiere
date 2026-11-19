// F36: what the app's file tree does to a vault: new notes and folders,
// renames and moves that update links through the will-rename listeners
// (the linkUpdates plugin in VS Code and here), and deletion.
import test from "node:test";
import assert from "node:assert/strict";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { NoteDocuments, noteFiles } from "../../src/host/documents";
import { createFileOperations } from "../../src/host/file-operations";
import { createNodePlatform } from "../../src/host/node-platform";
import { afterRenames } from "../../src/host/note-renames";
import { createWorkspaceFiles } from "../../src/host/workspace";

const uri = (file: string) => pathToFileURL(file).toString();

async function vault(t: test.TestContext) {
  const dir = await realpath(
    await mkdtemp(path.join(tmpdir(), "lumiere-ops-")),
  );
  const root = path.join(dir, "vault");
  await mkdir(path.join(root, "notes"), { recursive: true });
  await writeFile(path.join(root, "notes", "A.md"), "See [[B]].\n");
  await writeFile(path.join(root, "notes", "B.md"), "# B\n");
  const platform = createNodePlatform({
    data: path.join(dir, "data"),
    workers: "",
  });
  const roots = () => [uri(root)];
  const contained = createWorkspaceFiles(platform.files, roots);
  const documents = new NoteDocuments(
    { ...noteFiles(platform), move: (from, to) => contained.move(from, to) },
    10,
    () => {},
  );
  const operations = createFileOperations({
    files: platform.files,
    roots,
    documents,
  });
  t.after(async () => {
    await documents.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  return { dir, root, documents, operations };
}

/** The link edit linkUpdates would plan for A.md when B.md is renamed. */
function linkUpdate(root: string, source = "See [[B]].\n") {
  return async () => [
    {
      uri: uri(path.join(root, "notes", "A.md")),
      source,
      edits: [
        {
          start: { line: 0, col: 6 },
          end: { line: 0, col: 7 },
          text: "C",
        },
      ],
    },
  ];
}

test("a rename moves the note and updates the links to it, on disk and in an open note", async (t) => {
  const { root, documents, operations } = await vault(t);
  documents.onWillRename(linkUpdate(root));
  const renamed: string[] = [];
  operations.onDidRename((rename) => renamed.push(rename.newUri));
  const from = uri(path.join(root, "notes", "B.md"));
  const to = uri(path.join(root, "notes", "C.md"));
  assert.deepEqual(await operations.rename(from, to), []);
  assert.equal(
    await readFile(path.join(root, "notes", "C.md"), "utf8"),
    "# B\n",
  );
  await assert.rejects(access(path.join(root, "notes", "B.md")));
  assert.equal(
    await readFile(path.join(root, "notes", "A.md"), "utf8"),
    "See [[C]].\n",
  );
  assert.deepEqual(renamed, [to]);

  // Open, the linking note's text changes as an edit, written after the pause.
  const open = await documents.open(uri(path.join(root, "notes", "A.md")));
  documents.onWillRename(async () => [
    {
      uri: open.uri,
      source: open.getText(),
      edits: [
        { start: { line: 0, col: 6 }, end: { line: 0, col: 7 }, text: "D" },
      ],
    },
  ]);
  await operations.rename(to, uri(path.join(root, "notes", "D.md")));
  assert.equal(open.getText(), "See [[D]].\n");
});

test("links in a note changed since they were planned are left, and named", async (t) => {
  const { root, documents, operations } = await vault(t);
  documents.onWillRename(linkUpdate(root, "Something else\n"));
  const left = await operations.rename(
    uri(path.join(root, "notes", "B.md")),
    uri(path.join(root, "notes", "C.md")),
  );
  assert.deepEqual(left, [uri(path.join(root, "notes", "A.md"))]);
  assert.equal(
    await readFile(path.join(root, "notes", "A.md"), "utf8"),
    "See [[B]].\n",
  );
});

test("a folder moves with the notes in it; a target that exists or lies outside is refused", async (t) => {
  const { dir, root, operations } = await vault(t);
  await operations.rename(
    uri(path.join(root, "notes")),
    uri(path.join(root, "archive")),
  );
  assert.equal(
    await readFile(path.join(root, "archive", "A.md"), "utf8"),
    "See [[B]].\n",
  );
  await assert.rejects(
    operations.rename(
      uri(path.join(root, "archive", "A.md")),
      uri(path.join(root, "archive", "B.md")),
    ),
  );
  await assert.rejects(
    operations.rename(
      uri(path.join(root, "archive", "A.md")),
      uri(path.join(dir, "A.md")),
    ),
    /outside/,
  );
  assert.equal(
    afterRenames(uri("/v/a/b.md"), [
      { oldUri: uri("/v/a"), newUri: uri("/v/c") },
    ]),
    uri("/v/c/b.md"),
  );
});

test("new notes and folders are made once, and only inside the vault", async (t) => {
  const { dir, root, operations } = await vault(t);
  const note = uri(path.join(root, "Untitled.md"));
  await operations.createNote(note);
  assert.equal(await readFile(path.join(root, "Untitled.md"), "utf8"), "");
  await assert.rejects(operations.createNote(note), /already exists/);
  await operations.createFolder(uri(path.join(root, "new", "deeper")));
  await assert.rejects(
    operations.createFolder(uri(path.join(root, "new"))),
    /already exists/,
  );
  await assert.rejects(
    operations.createNote(uri(path.join(dir, "x.md"))),
    /outside/,
  );
});

test("deleting a folder removes what is in it, never what a link inside points at", async (t) => {
  const { dir, root, documents, operations } = await vault(t);
  const outside = path.join(dir, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "keep.md"), "keep");
  await symlink(outside, path.join(root, "notes", "link"));
  const open = await documents.open(uri(path.join(root, "notes", "A.md")));
  await documents.apply(open, [{ from: 0, to: 0, insert: "typed " }]);
  await operations.remove(uri(path.join(root, "notes")));
  await assert.rejects(access(path.join(root, "notes")));
  assert.equal(await readFile(path.join(outside, "keep.md"), "utf8"), "keep");
  // The open note is left clean: its page closing writes nothing back.
  assert.equal(open.isDirty, false);
  await assert.rejects(
    operations.remove(uri(path.join(root, "notes"))),
    /no such/,
  );
});

test("a note's title renames it only within its folder and kind", async (t) => {
  const { root, documents } = await vault(t);
  const note = await documents.open(uri(path.join(root, "notes", "B.md")));
  await assert.rejects(
    documents.rename(note, uri(path.join(root, "B.md"))),
    /Invalid note rename target/,
  );
  await assert.rejects(
    documents.rename(note, uri(path.join(root, "notes", "B.txt"))),
    /Invalid note rename target/,
  );
  await documents.rename(note, uri(path.join(root, "notes", "Bee.md")));
  assert.equal(
    await readFile(path.join(root, "notes", "Bee.md"), "utf8"),
    "# B\n",
  );
});
