import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANNOTATION_COLOR_COMMAND_IDS,
  MARK_COMMAND_IDS,
  VIEW_COMMAND_IDS,
} from "../../src/shared/command-ids";
import { VIEW_ACTION_COMMANDS } from "../../src/shared/view-commands";
import { pdfContributes } from "./support/manifest";

type MenuEntry = {
  command?: string;
  submenu?: string;
  when?: string;
  group?: string;
};
type Contributes = {
  commands: { command: string; title: string; enablement?: string }[];
  menus: Record<string, MenuEntry[]>;
  submenus: { id: string; label: string }[];
  keybindings: { command: string; when?: string }[];
};

const contributes = () => pdfContributes<Contributes>();
const contextEntry = (match: (entry: MenuEntry) => boolean) =>
  contributes().menus["webview/context"]?.find(match);

test("selected text gets Highlight, Add Annotation… and the Mark Text submenu", () => {
  const highlight = contextEntry(
    (entry) => entry.command === MARK_COMMAND_IDS.highlight,
  );
  const add = contextEntry(
    (entry) => entry.command === VIEW_COMMAND_IDS.addAnnotation,
  );
  const markText = contextEntry(
    (entry) => entry.submenu === "lumiere.pdf.markText",
  );
  for (const entry of [highlight, add, markText]) {
    assert.ok(entry);
    assert.match(entry.when ?? "", /webviewId == 'lumiere\.pdf\.viewer'/u);
    assert.match(entry.when ?? "", /lumiere\.pdf\.hasTextSelection/u);
    assert.match(entry.group ?? "", /^0_mark@/u);
  }
  assert.deepEqual(
    contributes().menus["lumiere.pdf.markText"]?.map((entry) => entry.command),
    [
      MARK_COMMAND_IDS.underline,
      MARK_COMMAND_IDS.strikeout,
      MARK_COMMAND_IDS.squiggly,
    ],
  );
});

test("a mark gets Edit Note…, Change Color and Delete, and nothing else does", () => {
  const entries = [
    contextEntry(
      (entry) => entry.command === VIEW_COMMAND_IDS.editAnnotationNote,
    ),
    contextEntry((entry) => entry.submenu === "lumiere.pdf.annotationColor"),
    contextEntry(
      (entry) => entry.command === VIEW_COMMAND_IDS.deleteAnnotation,
    ),
  ];
  for (const entry of entries) {
    assert.ok(entry?.when);
    assert.match(entry.when, /lumiere\.pdf\.hasAnnotationSelection/u);
    // Neither any selection nor the removed Annotate mode gates them.
    assert.doesNotMatch(
      entry.when.replace(/hasAnnotationSelection/gu, ""),
      /hasSelection|lumiere\.pdf\.tool/u,
    );
  }
  assert.deepEqual(
    contributes().menus["lumiere.pdf.annotationColor"]?.map(
      (entry) => entry.command,
    ),
    ANNOTATION_COLOR_COMMAND_IDS.map((command) => command.id),
  );
  const labels = Object.fromEntries(
    contributes().submenus.map((submenu) => [submenu.id, submenu.label]),
  );
  assert.equal(labels["lumiere.pdf.markText"], "Mark Text");
  assert.equal(labels["lumiere.pdf.annotationColor"], "Change Color");
});

test("the mark entries sit between the agent group and the view groups", () => {
  const groups = contributes()
    .menus["webview/context"]!.map((entry) => entry.group ?? "")
    .map((group) => group.split("@")[0]!);
  const sorted = [...new Set(groups)].sort();
  const mark = sorted.indexOf("0_mark");
  assert.ok(mark > sorted.indexOf("0_agent"));
  assert.ok(mark < sorted.indexOf("1_pdfView"));
});

test("there is no Annotate mode, tool picker or colour picker any more", () => {
  const ids = new Set(contributes().commands.map((entry) => entry.command));
  for (const removed of [
    "lumiere.pdf.selectAnnotateTool",
    "lumiere.pdf.toggleAnnotateTool",
    "lumiere.pdf.pickAnnotationTool",
    "lumiere.pdf.pickAnnotationColor",
  ]) {
    assert.equal(ids.has(removed), false, removed);
  }
  const text = JSON.stringify(contributes());
  assert.doesNotMatch(text, /lumiere\.pdf\.tool == 'annotate'/u);
  for (const tool of ["highlight", "underline", "strikeout"] as const) {
    const shortcut = contributes().keybindings.find(
      (entry) => entry.command === MARK_COMMAND_IDS[tool],
    );
    assert.match(shortcut?.when ?? "", /lumiere\.pdf\.hasTextSelection/u);
  }
});

test("each mark and colour command sends its viewer action", () => {
  const actions = new Map(
    VIEW_ACTION_COMMANDS.map((command) => [command.id, command.action]),
  );
  assert.deepEqual(actions.get(MARK_COMMAND_IDS.squiggly), {
    action: "markSelection",
    tool: "squiggly",
  });
  assert.deepEqual(actions.get("lumiere.pdf.annotationColor.blue"), {
    action: "setMarkColor",
    color: "#4DABF7",
  });
  assert.deepEqual(actions.get(VIEW_COMMAND_IDS.deleteAnnotation), {
    action: "deleteSelectedAnnotations",
  });
  // These ask for a note first: the annotations plugin registers them.
  assert.equal(actions.has(VIEW_COMMAND_IDS.addAnnotation), false);
  assert.equal(actions.has(VIEW_COMMAND_IDS.editAnnotationNote), false);
});
