import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_NOTE_LENGTH } from "../../src/shared/view-state";
import { loadModule } from "./support/load-module";

type Prompt = { title?: string; prompt?: string; value?: string };

/** The note commands with a fake VS Code, and one open PDF panel. */
function setUp(options: {
  selection: unknown;
  /** What the viewer reports when asked; none when undefined. */
  fresh?: unknown;
  typed?: string;
}) {
  const prompts: Prompt[] = [];
  const warnings: string[] = [];
  const acts: unknown[] = [];
  const order: string[] = [];
  const panel = {
    selection: options.selection,
    act: (action: unknown) => acts.push({ ...(action as object) }),
    refreshSelection: async () => {
      order.push("refresh");
      if (options.fresh === undefined) {
        return false;
      }
      panel.selection = options.fresh;
      return true;
    },
  };
  const module = loadModule(
    new URL(
      "../../src/extension/plugins/pdfAnnotations/mark-notes.ts",
      import.meta.url,
    ),
    {
      vscode: {
        window: {
          showInputBox: async (prompt: Prompt) => {
            order.push("prompt");
            prompts.push(prompt);
            return options.typed;
          },
          showWarningMessage: async (message: string) => {
            warnings.push(message);
          },
        },
      },
      "../../../shared/view-state": { MAX_NOTE_LENGTH },
    },
  ) as {
    addAnnotation: (panels: unknown) => Promise<void>;
    editAnnotationNote: (panels: unknown) => Promise<void>;
  };
  const panels = { active: panel, all: [panel] };
  return { module, panels, prompts, warnings, acts, order };
}

const text = (words: string) => ({
  kind: "text",
  text: words,
  pages: [{ page: 1, rects: [[0, 0, 10, 10]] }],
});

test("Add Annotation asks the viewer for its selection before quoting it", async () => {
  // The extension still holds an older selection; the viewer has a newer one.
  const view = setUp({
    selection: text("older words"),
    fresh: text("newer words"),
    typed: "a note",
  });
  await view.module.addAnnotation(view.panels);
  assert.deepEqual(view.order, ["refresh", "prompt"]);
  assert.match(view.prompts[0]!.prompt!, /newer words/u);
  assert.deepEqual(view.acts, [
    { action: "markSelection", tool: "highlight", note: "a note" },
  ]);
});

test("Add Annotation still works when the viewer's text has not been reported", async () => {
  const view = setUp({ selection: text("older words"), typed: "" });
  await view.module.addAnnotation(view.panels);
  // No stale quote, and an empty note makes a plain highlight.
  assert.equal(view.prompts[0]!.prompt, "Note for the selected text");
  assert.deepEqual(view.acts, [{ action: "markSelection", tool: "highlight" }]);
});

test("Escape in Add Annotation marks nothing", async () => {
  const view = setUp({ selection: text("words"), fresh: text("words") });
  await view.module.addAnnotation(view.panels);
  assert.deepEqual(view.acts, []);
});

test("Edit Note starts from the mark's note and can empty it", async () => {
  const mark = {
    kind: "region",
    page: 1,
    rect: [0, 0, 10, 10],
    mark: true,
    note: "old note",
  };
  const view = setUp({ selection: mark, typed: "   " });
  await view.module.editAnnotationNote(view.panels);
  assert.equal(view.prompts[0]!.value, "old note");
  assert.deepEqual(view.acts, [{ action: "setMarkNote", note: "" }]);
});

test("Edit Note refuses a note too long to have been sent, rather than erase it", async () => {
  const view = setUp({
    selection: {
      kind: "region",
      page: 1,
      rect: [0, 0, 10, 10],
      mark: true,
      noteTooLong: true,
    },
    typed: "replacement",
  });
  await view.module.editAnnotationNote(view.panels);
  assert.deepEqual(view.prompts, []);
  assert.deepEqual(view.acts, []);
  assert.equal(view.warnings.length, 1);
});
