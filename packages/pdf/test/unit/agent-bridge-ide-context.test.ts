import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
// First: everything below imports 'vscode', which this points at the fake.
import "./support/install-fake-vscode";
import * as vscode from "./support/fake-vscode";
import type {
  ActiveNote,
  NoteSelections,
} from "../../src/extension/plugins/agentBridge/note-selections";
import {
  callTool,
  fakeDeps,
  fakePanels,
  withClient,
} from "./support/bridge-tools";
import {
  installWorkspace,
  type WorkspaceFixture,
} from "./support/workspace-fixture";

/**
 * get_ide_context and lumiere://ide-context: where the user is in Lumiere's
 * notes and PDFs, through a real MCP client.
 */

let workspace: WorkspaceFixture;
beforeEach(async () => {
  workspace = await installWorkspace();
});
afterEach(async () => {
  vscode.window.tabGroups.all = [];
  delete (vscode.window as { activeTextEditor?: unknown }).activeTextEditor;
  await workspace.remove();
});

const PDF_TYPE = "lumiere.pdf.viewer";
const NOTE_TYPE = "lumiere.markdown.editor";

function tab(
  relative: string,
  viewType: string,
  flags: { active?: boolean; dirty?: boolean } = {},
) {
  return {
    input: { uri: workspace.uri(relative), viewType },
    isActive: flags.active ?? false,
    isDirty: flags.dirty ?? false,
  };
}

function openTabs(
  ...groups: { active: boolean; tabs: ReturnType<typeof tab>[] }[]
): void {
  vscode.window.tabGroups.all = groups.map(({ active, tabs }) => ({
    isActive: active,
    tabs,
  }));
}

/** A viewer with a selection; `rects` are one page's text lines. */
function pdfPanel(selection?: unknown) {
  return {
    uri: workspace.uri("papers/a.pdf"),
    view: { page: 3, pageCount: 12, zoomPercent: 125 },
    sha256: "cd".repeat(32),
    selectionSnapshot: () =>
      selection
        ? {
            selection,
            sha256: "cd".repeat(32),
            selectedAt: "2026-11-22T00:00:00Z",
          }
        : undefined,
  };
}

const note = (extra: Partial<ActiveNote> = {}): NoteSelections => ({
  hasOpenNotes: () => true,
  current: async () => undefined,
  active: async () => ({
    uri: workspace.uri("notes/idea.md") as never,
    isDirty: false,
    headingPath: [],
    ...extra,
  }),
});

async function context(deps = fakeDeps()) {
  return (await callTool(deps, "get_ide_context")).json() as Record<
    string,
    unknown
  >;
}

test("with nothing open of Lumiere's, the context says so", async () => {
  const result = await context();
  assert.deepEqual(result.tabs, []);
  assert.deepEqual(result.warnings, ["No Lumiere note or PDF is open."]);
  assert.equal("note" in result || "pdf" in result || "focus" in result, false);
});

test("the active note: its path, selected lines and text, and the headings above them", async () => {
  const notes = note({
    isDirty: true,
    selection: {
      text: "the quoted passage",
      from: 40,
      to: 58,
      startLine: 12,
      endLine: 13,
    },
    headingPath: ["Plan", "Risks"],
  });
  const result = await context(fakeDeps({ notes }));
  assert.deepEqual(result.note, {
    path: "notes/idea.md",
    dirty: true,
    selection: {
      startLine: 12,
      endLine: 13,
      text: "the quoted passage",
      truncated: false,
    },
    headingPath: ["Plan", "Risks"],
  });
});

test("a note with nothing selected has no selection and no caret, which Lumiere does not report", async () => {
  const result = await context(fakeDeps({ notes: note() }));
  assert.deepEqual(result.note, {
    path: "notes/idea.md",
    dirty: false,
    headingPath: [],
  });
});

test("a long note selection is cut to the packet's cap and says so", async () => {
  const text = "x".repeat(20_000);
  const notes = note({
    selection: { text, from: 0, to: text.length, startLine: 1, endLine: 1 },
  });
  const result = (await context(fakeDeps({ notes }))) as {
    note: { selection: { text: string; truncated: boolean } };
    warnings: string[];
  };
  assert.equal(result.note.selection.truncated, true);
  assert.ok(
    result.note.selection.text.length <= 8_000,
    String(result.note.selection.text.length),
  );
  assert.ok(
    result.warnings.some((warning) => /truncat/u.test(warning)),
    result.warnings.join(),
  );
});

/** A text editor in focus, as VS Code reports it. */
function focusTextEditor(relative: string, caret = { line: 4, character: 2 }) {
  (vscode.window as { activeTextEditor?: unknown }).activeTextEditor = {
    document: {
      uri: workspace.uri(relative),
      languageId: "typescript",
      isDirty: false,
    },
    selection: { active: caret },
  } as never;
}

test("a text editor in focus does not put the packet's internal warning in the context, and its caret is not taken for the note's", async () => {
  focusTextEditor("src/x.ts");
  const panel = pdfPanel();
  const result = (await context(
    fakeDeps({ panels: fakePanels([panel], panel), notes: note() }),
  )) as {
    note: Record<string, unknown>;
    warnings: string[];
  };
  assert.deepEqual(result.warnings, []);
  assert.equal("caret" in result.note, false);
});

test("a text editor that shows the note gives its caret, one-based", async () => {
  focusTextEditor("notes/idea.md");
  const result = (await context(fakeDeps({ notes: note() }))) as {
    note: { caret?: { line: number; column: number } };
    warnings: string[];
  };
  assert.deepEqual(result.note.caret, { line: 5, column: 3 });
  assert.deepEqual(result.warnings, []);
});

test("the PDF: path, page, page count, zoom and hash, with a locator to the page", async () => {
  const panel = pdfPanel();
  const result = await context(
    fakeDeps({ panels: fakePanels([panel], panel) }),
  );
  assert.deepEqual(result.pdf, {
    path: "papers/a.pdf",
    page: 3,
    pageCount: 12,
    zoomPercent: 125,
    sha256: "cd".repeat(32),
    locator: "papers/a.pdf#page=3",
    selection: { kind: "none" },
  });
});

test("a selected passage comes with its pages and a text-fragment locator", async () => {
  const panel = pdfPanel({
    kind: "text",
    text: "Scaled dot-product\nattention",
    pages: [{ page: 5, rects: [[10, 20, 110, 32]] }],
  });
  const result = (await context(
    fakeDeps({ panels: fakePanels([panel], panel) }),
  )) as {
    pdf: { locator: string; selection: unknown };
  };
  assert.deepEqual(result.pdf.selection, {
    kind: "text",
    text: "Scaled dot-product\nattention",
    truncated: false,
    pages: [5],
  });
  assert.equal(
    result.pdf.locator,
    "papers/a.pdf#page=5#:~:text=Scaled%20dot%2Dproduct%20attention",
  );
});

test("a selected region comes as a view rectangle in its locator", async () => {
  const panel = pdfPanel({ kind: "region", page: 2, rect: [10, 20, 110, 70] });
  const result = (await context(
    fakeDeps({ panels: fakePanels([panel], panel) }),
  )) as {
    pdf: { locator: string; selection: unknown };
  };
  assert.deepEqual(result.pdf.selection, {
    kind: "region",
    page: 2,
    viewrect: { left: 10, top: 20, width: 100, height: 50 },
  });
  assert.equal(result.pdf.locator, "papers/a.pdf#page=2&viewrect=10,20,100,50");
});

test("a long PDF selection is cut to the packet's cap", async () => {
  const text = "y".repeat(20_000);
  const panel = pdfPanel({
    kind: "text",
    text,
    pages: [{ page: 1, rects: [[0, 0, 1, 1]] }],
  });
  const result = (await context(
    fakeDeps({ panels: fakePanels([panel], panel) }),
  )) as {
    pdf: { selection: { text: string; truncated: boolean } };
  };
  assert.equal(result.pdf.selection.truncated, true);
  assert.ok(result.pdf.selection.text.length <= 8_000);
});

test("the Lumiere tabs carry visible, active and dirty flags, and name workspace paths only", async () => {
  openTabs(
    {
      active: false,
      tabs: [
        tab("papers/b.pdf", PDF_TYPE, { active: true }),
        tab("papers/a.pdf", PDF_TYPE),
      ],
    },
    {
      active: true,
      tabs: [
        tab("notes/idea.md", NOTE_TYPE, { active: true, dirty: true }),
        // Not Lumiere's: a text editor, and a Lumiere PDF outside the workspace.
        {
          input: { uri: workspace.uri("src/x.ts"), viewType: "default" },
          isActive: false,
          isDirty: false,
        },
        {
          input: {
            uri: vscode.Uri.file(workspace.outside),
            viewType: PDF_TYPE,
          },
          isActive: false,
          isDirty: false,
        },
      ],
    },
  );
  const result = (await context()) as {
    focus: string;
    tabs: unknown[];
    warnings: string[];
  };
  assert.equal(result.focus, "note");
  assert.deepEqual(result.tabs, [
    {
      kind: "pdf",
      path: "papers/b.pdf",
      visible: true,
      active: false,
      dirty: false,
    },
    {
      kind: "pdf",
      path: "papers/a.pdf",
      visible: false,
      active: false,
      dirty: false,
    },
    {
      kind: "note",
      path: "notes/idea.md",
      visible: true,
      active: true,
      dirty: true,
    },
  ]);
  assert.deepEqual(result.warnings, [
    "1 open tab(s) outside the workspace are not listed",
    "No Lumiere note or PDF is open.",
  ]);
});

test("more tabs than the cap are counted, not all listed", async () => {
  openTabs({
    active: true,
    tabs: Array.from({ length: 25 }, (_, i) =>
      tab(`papers/${i}.pdf`, PDF_TYPE, { active: i === 0 }),
    ),
  });
  const result = (await context()) as { tabs: unknown[]; warnings: string[] };
  assert.equal(result.tabs.length, 20);
  assert.ok(result.warnings.includes("5 more open tab(s) are not listed"));
});

test("the resource lumiere://ide-context lists and reads as the same JSON, as the one tool", async () => {
  const panel = pdfPanel();
  const deps = fakeDeps({ panels: fakePanels([panel], panel), notes: note() });
  await withClient(deps, async (client) => {
    const listed = (await client.listResources()).resources;
    assert.deepEqual(
      listed.map(({ uri, mimeType }) => ({ uri, mimeType })),
      [{ uri: "lumiere://ide-context", mimeType: "application/json" }],
    );
    const read = await client.readResource({ uri: "lumiere://ide-context" });
    const [content] = read.contents as {
      uri: string;
      mimeType: string;
      text: string;
    }[];
    assert.equal(content!.uri, "lumiere://ide-context");
    assert.equal(content!.mimeType, "application/json");
    const fromResource = JSON.parse(content!.text) as Record<string, unknown>;
    const fromTool = await context(deps);
    delete fromResource.collectedAt;
    delete fromTool.collectedAt;
    assert.deepEqual(fromResource, fromTool);
    assert.ok(fromResource.pdf && fromResource.note);
  });
});
