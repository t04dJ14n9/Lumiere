import assert from "node:assert/strict";
import test from "node:test";
import { insertionMessages } from "../../../src/plugins/templates/host";

const names = { note: "Plan.md", template: "Templates/Meeting.md" };

test("invalid properties are blamed on the file that has them", () => {
  assert.deepEqual(
    insertionMessages({
      isInserted: true,
      invalidProperties: "template",
      unsupported: [],
      ...names,
    }),
    [
      "The template's properties were not added: the properties of the template Templates/Meeting.md are not valid YAML once its variables are filled in. Only its body was inserted.",
    ],
  );
  assert.deepEqual(
    insertionMessages({
      isInserted: true,
      invalidProperties: "note",
      unsupported: [],
      ...names,
    }),
    [
      "The template's properties were not added: the properties of Plan.md are not valid YAML.",
    ],
  );
});
