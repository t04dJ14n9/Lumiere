import assert from "node:assert/strict";
import test from "node:test";
import {
  adjacentDailyNote,
  dailyNoteKey,
  dailyNotePath,
  dailyTemplatePath,
} from "../../../src/plugins/dailyNotes/names";

const NOW = new Date(2026, 10, 5, 23, 30);
const settings = (folder: string, dateFormat = "") => ({
  folder,
  dateFormat,
  template: "",
});

test("today's path is folder/format(today).md in local time", () => {
  assert.equal(dailyNotePath(settings(""), NOW), "2026-11-05.md");
  assert.equal(
    dailyNotePath(settings("/Journal/"), NOW),
    "Journal/2026-11-05.md",
  );
  assert.equal(
    dailyNotePath(settings("Journal", "YYYY/MM/DD.MM.YYYY"), NOW),
    "Journal/2026/11/05.11.2026.md",
  );
  assert.equal(dailyNotePath(settings("../out"), NOW), undefined);
});

test("template paths gain .md the way Obsidian stores them", () => {
  assert.equal(dailyTemplatePath("Templates/Daily"), "Templates/Daily.md");
  assert.equal(dailyTemplatePath("/Templates/Daily.md"), "Templates/Daily.md");
  assert.equal(dailyTemplatePath(""), undefined);
  assert.equal(dailyTemplatePath("../Daily"), undefined);
});

test("only paths written by the format in the folder are daily notes", () => {
  const journal = settings("Journal", "DD-MM-YYYY");
  assert.equal(
    dailyNoteKey("Journal/05-11-2026.md", journal),
    "20261105000000",
  );
  assert.equal(dailyNoteKey("Journal/5-11-2026.md", journal), undefined);
  assert.equal(dailyNoteKey("Other/05-11-2026.md", journal), undefined);
  assert.equal(dailyNoteKey("Journal/05-11-2026.txt", journal), undefined);
  assert.equal(dailyNoteKey("2026-11-05.md", settings("")), "20261105000000");
  // Dots in the format are literal, not "any character".
  assert.equal(
    dailyNoteKey("Journal/05x11x2026.md", settings("Journal", "DD.MM.YYYY")),
    undefined,
  );
});

test("previous and next skip missing days and order by date, not by name", () => {
  const journal = settings("Journal", "DD-MM-YYYY");
  const paths = [
    "Journal/30-10-2026.md",
    "Journal/02-11-2026.md",
    "Journal/05-11-2026.md",
    "Journal/01-01-2027.md",
    "Journal/notes.md",
    "Elsewhere/03-11-2026.md",
  ];
  const reference = dailyNoteKey("Journal/05-11-2026.md", journal)!;
  assert.equal(
    adjacentDailyNote(paths, journal, reference, -1),
    "Journal/02-11-2026.md",
  );
  assert.equal(
    adjacentDailyNote(paths, journal, reference, 1),
    "Journal/01-01-2027.md",
  );
  const first = dailyNoteKey("Journal/30-10-2026.md", journal)!;
  assert.equal(adjacentDailyNote(paths, journal, first, -1), undefined);
});
