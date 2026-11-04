import test from "node:test";
import assert from "node:assert/strict";
import { missingEmbedText } from "./post-process";

test("a missing image embed says it failed to fetch, not the note path wording", () => {
  assert.equal(
    missingEmbedText("attachments/missing.png"),
    "failed to fetch image",
  );
  assert.equal(missingEmbedText("gone.png|200"), "failed to fetch image");
});

test("a missing non-image file still names its path", () => {
  assert.equal(
    missingEmbedText("attachments/report.pdf"),
    '"attachments/report.pdf" could not be found.',
  );
  assert.equal(
    missingEmbedText("MissingNote"),
    '"MissingNote" could not be found.',
  );
});

// Measured in a throwaway Obsidian vault (2026-10-17).
test("a missing heading or block in an existing note names the note, as Obsidian does", () => {
  assert.equal(
    missingEmbedText("#Local", { note: "probe", section: true }),
    "Unable to find “Local” in probe",
  );
  assert.equal(
    missingEmbedText("folder/Other#Missing|alias", {
      note: "probe",
      section: true,
    }),
    "Unable to find “Missing” in Other",
  );
  assert.equal(
    missingEmbedText("Gone#Heading"),
    '"Gone#Heading" could not be found.',
  );
});
