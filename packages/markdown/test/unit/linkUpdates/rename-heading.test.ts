import assert from "node:assert/strict";
import test from "node:test";
import type { Editors } from "../../../src/plugins/editor/api";
import { renameHeading } from "../../../src/plugins/linkUpdates/rename-heading";
import { SourceCoordinates } from "../../../src/shared/document/coordinates";
import type { HostDocument, TextEdit } from "../../../src/shared/host";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";
import { memoryVaults, uriOf } from "../views/fakes";

/** What `hostDocuments.apply` does: editor (LF) offsets in, source text out. */
function applyEditorEdits(source: string, edits: readonly TextEdit[]): string {
  const coordinates = new SourceCoordinates(source);
  return edits
    .map((edit) => ({
      from: coordinates.toSource(edit.from),
      to: coordinates.toSource(edit.to),
      insert: edit.insert,
    }))
    .sort((a, b) => b.from - a.from)
    .reduce(
      (text, edit) =>
        text.slice(0, edit.from) + edit.insert + text.slice(edit.to),
      source,
    );
}

/** Renames the heading holding `caretAt` in `Note.md`; `input` is the prompt. */
async function rename(
  notes: Record<string, string>,
  caretAt: string,
  input: (docs: Map<string, string>) => string,
  isApplied = true,
) {
  const docs = new Map(
    Object.entries(notes).map(([path, text]) => [uriOf(path), text]),
  );
  const informed: string[] = [];
  const document = (uri: string): HostDocument =>
    fakeDocument({ uri, id: uri, getText: () => docs.get(uri) ?? "" });
  const host = fakeHost({
    dialogs: {
      inform: (message) => informed.push(message),
      input: async () => input(docs),
    },
    hostDocuments: {
      text: (uri) => docs.get(uri),
      open: async (uri) => document(uri),
      apply: async (target, edits) => {
        // Only the note being renamed can refuse its edit.
        if (!isApplied && target.uri === uriOf("Note.md")) {
          return false;
        }
        docs.set(target.uri, applyEditorEdits(target.getText(), edits));
        return true;
      },
    },
  });
  const note = notes["Note.md"]!;
  const caret = new SourceCoordinates(note).toEditor(
    note.indexOf(caretAt) + caretAt.length,
  );
  const panel = {
    document: document(uriOf("Note.md")),
    rpc: {
      call: async () => ({ from: caret, to: caret, version: 1, text: "" }),
    },
  };
  await renameHeading({
    editors: { active: () => panel } as unknown as Editors,
    dialogs: host.dialogs,
    vaults: memoryVaults(notes).vaults,
    hostDocuments: host.hostDocuments,
  });
  return { text: (path: string) => docs.get(uriOf(path)), informed };
}

test("renaming a heading in a CRLF note edits the heading and its links in place", async () => {
  const { text } = await rename(
    { "Note.md": "Intro\r\n\r\n# Old\r\nSee [[#Old]]\r\n" },
    "# Old",
    () => "New",
  );
  assert.equal(text("Note.md"), "Intro\r\n\r\n# New\r\nSee [[#New]]\r\n");
});

test("renaming a heading updates the links in a CRLF note that links to it", async () => {
  const { text } = await rename(
    {
      "Note.md": "Intro\r\n\r\n# Old\r\n",
      "Other.md": "Line\r\nSee [[Note#Old]] here\r\n",
    },
    "# Old",
    () => "New",
  );
  assert.equal(text("Other.md"), "Line\r\nSee [[Note#New]] here\r\n");
  assert.equal(text("Note.md"), "Intro\r\n\r\n# New\r\n");
});

test("a note edited while the name is asked is left alone and the user is told", async () => {
  const note = "# Old\n\nSee [[#Old]].\n";
  const edited = `A line added meanwhile\n${note}`;
  const { text, informed } = await rename(
    { "Note.md": note, "Other.md": "See [[Note#Old]].\n" },
    "# Old",
    (docs) => {
      docs.set(uriOf("Note.md"), edited);
      return "New";
    },
  );
  assert.equal(text("Note.md"), edited);
  assert.equal(text("Other.md"), "See [[Note#Old]].\n");
  assert.deepEqual(informed, [
    "The note changed while the heading was being renamed. Try again.",
  ]);
});

test("when the note itself cannot be edited, the notes linking to it are left alone", async () => {
  const { text } = await rename(
    { "Note.md": "# Old\n", "Other.md": "See [[Note#Old]].\n" },
    "# Old",
    () => "New",
    false,
  );
  assert.equal(text("Other.md"), "See [[Note#Old]].\n");
});
