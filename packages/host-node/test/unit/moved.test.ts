// A page whose note is renamed (its inline title) is told where the note is
// now, and passes it to its embedder with its scroll position: DSH then
// shows the note at its new path, as the app's window does.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MARKDOWN_EDITOR } from "@workshop/markdown/portable";
import { parseMovedMessage } from "../../src/embedding";
import { NoteDocuments, noteFiles } from "../../src/host/documents";
import { createNodePlatform } from "../../src/host/node-platform";
import type { PageSocket } from "../../src/host/panel";
import { PanelHub } from "../../src/host/panels";
import { carryState, movedSearch, stateKey } from "../../src/page/moved";
import { parseHostFrame } from "../../src/protocol";

const urls = () => ({
  cspSource: "'self'",
  asset: (relative: string) => `/lumiere/m/${relative}`,
  resource: (uri: string) => uri,
});

function socket(sent: unknown[]): PageSocket {
  return {
    send: (text) => sent.push(JSON.parse(text)),
    onMessage: () => () => {},
    onClose: () => () => {},
    close: () => {},
  };
}

test("each page of a renamed note is told its new path; other pages are not", async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), "lumiere-moved-"));
  await writeFile(path.join(dir, "Note.md"), "hello");
  await writeFile(path.join(dir, "Other.md"), "other");
  const platform = createNodePlatform({ data: tmpdir(), workers: "" });
  const documents = new NoteDocuments(
    {
      ...noteFiles(platform),
      move: (from, to) => platform.files.move(from, to),
    },
    60_000,
  );
  const hub = new PanelHub(documents);
  hub.register(MARKDOWN_EDITOR, (shell) => shell.setHTML("<html></html>"));
  hub.followRenames((uri) => fileURLToPath(uri));
  t.after(async () => {
    hub.dispose();
    await documents.dispose();
    await rm(dir, { recursive: true, force: true });
  });
  const uri = (name: string) => pathToFileURL(path.join(dir, name)).toString();
  const renamed: unknown[] = [];
  const other: unknown[] = [];
  const note = await hub.open({ uri: uri("Note.md"), urls });
  hub.attach(note.id, socket(renamed));
  const second = await hub.open({ uri: uri("Other.md"), urls });
  hub.attach(second.id, socket(other));

  await documents.renames.renameFiles([
    { oldUri: uri("Note.md"), newUri: uri("Renamed.md") },
  ]);
  assert.equal(await readFile(path.join(dir, "Renamed.md"), "utf8"), "hello");
  const moved = { type: "moved", path: path.join(dir, "Renamed.md") };
  assert.deepEqual(
    renamed.filter((frame) => JSON.stringify(frame).includes('"moved"')),
    [{ ch: "ui", data: moved }],
  );
  assert.equal(
    other.some((frame) => JSON.stringify(frame).includes('"moved"')),
    false,
  );
  // The page accepts it, and the embedder accepts what the page passes on.
  assert.deepEqual(parseHostFrame(JSON.stringify({ ch: "ui", data: moved })), {
    ch: "ui",
    data: moved,
  });
  assert.deepEqual(parseMovedMessage({ lumiere: "moved", path: moved.path }), {
    lumiere: "moved",
    path: moved.path,
  });
  assert.equal(parseMovedMessage({ lumiere: "moved", path: "" }), undefined);
});

test("the page at the new path keeps the old query's order and the saved scroll position", () => {
  const before = "?path=%2Fv%2FOld+note.md&root=%2Fv&session=s1";
  const after = movedSearch(before, "/v/New note.md");
  assert.equal(after, "?path=%2Fv%2FNew+note.md&root=%2Fv&session=s1");
  // As DSH writes a page's query (client/note-frame.ts `pageSearchParams`).
  assert.equal(
    after,
    `?${new URLSearchParams({ path: "/v/New note.md", root: "/v", session: "s1" })}`,
  );
  const saved = new Map([[stateKey(before), '{"scrollTop":420}']]);
  carryState(before, after, {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => void saved.set(key, value),
  });
  assert.equal(saved.get(stateKey(after)), '{"scrollTop":420}');
});
