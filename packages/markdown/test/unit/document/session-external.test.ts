import test from "node:test";
import assert from "node:assert/strict";
import { Session } from "../../../src/plugins/document/session";
import { fakeDocument, fakeHost } from "../../support/vscode-fake";

test("own save echo does not clear UndoGroups", async () => {
  let text = "note";
  let saved = "note";
  const doc = fakeDocument({
    getText: () => text,
    get isDirty() {
      return text !== saved;
    },
    async save() {
      saved = text;
      return true;
    },
  });
  const clears: string[] = [];
  const session = new Session(doc, fakeHost());
  const groups = (session as any).groups;
  const clear = groups.clear.bind(groups);
  groups.clear = () => {
    clears.push("clear");
    clear();
  };
  groups.record("note", "note!");
  text = "note!";
  session.changed(); // may clear; reset:
  clears.length = 0;
  groups.record("note", "note!");
  await session.save();
  session.changed(); // echo
  assert.deepEqual(clears, []);
  assert.equal((session as any).lastSaved, "note!");
});
