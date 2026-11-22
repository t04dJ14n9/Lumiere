import test from "node:test";
import assert from "node:assert/strict";
import type { MarkdownWorkshopApi } from "@workshop/markdown/host";
import {
  headingPathAt,
  markdownNoteSelections,
} from "../../src/note-selections";

const heading = (level: number, label: string, line: number) => ({
  level,
  label,
  position: { start: { line } },
});

// Zero-based lines, as the metadata index counts: lines 1, 5, 9, 12 and 20 (1-based: 2, 6, 10, 13, 21).
const headings = [
  heading(1, "Plan", 1),
  heading(2, "Risks", 5),
  heading(3, "Budget", 9),
  heading(2, "Timeline", 12),
  heading(1, "Notes", 20),
];

test("the heading path of a line is the chain of headings above it, outermost first", () => {
  assert.deepEqual(headingPathAt(headings, 1), []);
  assert.deepEqual(headingPathAt(headings, 2), ["Plan"]);
  assert.deepEqual(headingPathAt(headings, 8), ["Plan", "Risks"]);
  assert.deepEqual(headingPathAt(headings, 11), ["Plan", "Risks", "Budget"]);
  // A heading of the same or a higher level closes the ones below it.
  assert.deepEqual(headingPathAt(headings, 13), ["Plan", "Timeline"]);
  assert.deepEqual(headingPathAt(headings, 30), ["Notes"]);
  assert.deepEqual(headingPathAt([], 5), []);
});

interface FakeEditor {
  editorId: string;
  uri: string;
  isActive: boolean;
  isDirty: boolean;
  selection?: {
    text: string;
    from: number;
    to: number;
    startLine: number;
    endLine: number;
  };
}

function fakeApi(editors: FakeEditor[]): MarkdownWorkshopApi {
  return {
    getEditors: () => editors,
    getActiveEditor: () => editors.find(({ isActive }) => isActive),
    getSelection: async (id: string) => {
      const found = editors.find(({ editorId }) => editorId === id);
      return found?.selection && { ...found.selection, isDirty: found.isDirty };
    },
    getMetadata: () => ({ headings }),
  } as unknown as MarkdownWorkshopApi;
}

const selection = {
  text: "words",
  from: 30,
  to: 35,
  startLine: 11,
  endLine: 11,
};

test("the active note comes with its selection and the headings above it", async () => {
  const notes = markdownNoteSelections(() =>
    fakeApi([
      { editorId: "1", uri: "file:///a.md", isActive: false, isDirty: false },
      {
        editorId: "2",
        uri: "file:///b.md",
        isActive: true,
        isDirty: true,
        selection,
      },
    ]),
  );
  assert.deepEqual(await notes.active(), {
    uri: "file:///b.md",
    isDirty: true,
    selection,
    headingPath: ["Plan", "Risks", "Budget"],
  });
});

test("a note with nothing selected has no selection and no headings; none open, or Lumiere not started, is none", async () => {
  const idle = markdownNoteSelections(() =>
    fakeApi([
      { editorId: "1", uri: "file:///a.md", isActive: false, isDirty: false },
    ]),
  );
  // No note is active, so the first open one stands in.
  assert.deepEqual(await idle.active(), {
    uri: "file:///a.md",
    isDirty: false,
    headingPath: [],
  });
  assert.equal(
    await markdownNoteSelections(() => fakeApi([])).active(),
    undefined,
  );
  assert.equal(
    await markdownNoteSelections(() => undefined).active(),
    undefined,
  );
});

test("a selection in another note is found by current(), with its offsets", async () => {
  const notes = markdownNoteSelections(() =>
    fakeApi([
      { editorId: "1", uri: "file:///a.md", isActive: true, isDirty: false },
      {
        editorId: "2",
        uri: "file:///b.md",
        isActive: false,
        isDirty: false,
        selection,
      },
    ]),
  );
  assert.deepEqual(await notes.current(), {
    uri: "file:///b.md",
    ...selection,
    isDirty: false,
  });
});
