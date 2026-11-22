import assert from "node:assert/strict";
import { test } from "node:test";
// First: everything below imports 'vscode', which this points at the fake.
import "./support/install-fake-vscode";
import * as vscode from "./support/fake-vscode";
import type {
  NoteSelection,
  NoteSelections,
} from "../../src/extension/plugins/agentBridge/note-selections";
import { callTool, fakeDeps } from "./support/bridge-tools";

/** What get_current_note_selection answers, through a real MCP client. */
async function noteSelectionText(notes?: NoteSelections): Promise<string> {
  const answer = await callTool(
    fakeDeps(notes ? { notes } : {}),
    "get_current_note_selection",
  );
  return answer.text;
}

const notes = (
  selection: NoteSelection | undefined,
  open = true,
): NoteSelections => ({
  hasOpenNotes: () => open,
  current: async () => selection,
  active: async () => undefined,
});

test("the note selection comes from Lumiere in the same extension", async () => {
  const text = await noteSelectionText(
    notes({
      uri: vscode.Uri.parse("untitled:Draft.md") as never,
      text: "the quoted passage",
      from: 20,
      to: 38,
      startLine: 3,
      endLine: 4,
      isDirty: false,
    }),
  );
  assert.match(text, /#3-4/u);
  assert.match(text, /the quoted passage/u);
});

test("without a selection, an open note or Lumiere, the tool says which", async () => {
  assert.match(
    await noteSelectionText(notes(undefined)),
    /No text is selected/u,
  );
  assert.match(
    await noteSelectionText(notes(undefined, false)),
    /No note is open/u,
  );
  assert.match(await noteSelectionText(), /not running/u);
});
