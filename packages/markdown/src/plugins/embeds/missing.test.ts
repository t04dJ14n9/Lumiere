import test from "node:test";
import assert from "node:assert/strict";
import { missingEmbedText } from "./missing";

// Obsidian shows “linktext” could not be found. for a missing attachment,
// images included (measured in r2.json, `![[pic.png]]` and `![alt](pic.png)`).
test("a missing image names its path, like any other missing file", () => {
  assert.equal(
    missingEmbedText("attachments/missing.png"),
    "“attachments/missing.png” could not be found.",
  );
  assert.equal(
    missingEmbedText("gone.png|200"),
    "“gone.png” could not be found.",
  );
});

test("a missing non-image file names its path", () => {
  assert.equal(
    missingEmbedText("attachments/report.pdf"),
    "“attachments/report.pdf” could not be found.",
  );
  assert.equal(
    missingEmbedText("MissingNote"),
    "“MissingNote” could not be found.",
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
    "“Gone#Heading” could not be found.",
  );
});

test("an image whose bytes failed to load says failed to fetch, even without an image extension", () => {
  assert.equal(
    missingEmbedText("https://cdn.example/photo?id=1", { fetchFailed: true }),
    "failed to fetch image",
  );
  assert.equal(
    missingEmbedText("data:image/png;base64,xx", { fetchFailed: true }),
    "failed to fetch image",
  );
});

test("a circular or too deeply nested embed says so, not that the note is missing", () => {
  assert.equal(
    missingEmbedText("A#Second", { refused: "circular", section: false }),
    "“A#Second” embeds itself, so it is not shown again.",
  );
  assert.equal(
    missingEmbedText("Deep", { refused: "too deep" }),
    "“Deep” is nested too deeply to show.",
  );
});
