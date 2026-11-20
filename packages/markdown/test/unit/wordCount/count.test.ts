import test from "node:test";
import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import type * as WorkbenchService from "../../../src/host/services/workbench";
import { countText, formatCounts } from "../../../src/plugins/wordCount/count";
import { forgetModules } from "../../support/module-cache";

// Each count below was read from Obsidian's status bar for the same text.
test("words are counted as Obsidian counts them", () => {
  const cases: [string, number][] = [
    ["", 0],
    ["one two  three", 3],
    ["---\ntitle: Many words here\n---\nBody only", 2],
    ["[[Link|Alias]] and [md](url)", 5],
    // Hyphens and apostrophes join a word, and a lone `-` is one.
    ["snake_case and kebab-case", 4],
    ["- item one\n- item two", 6],
    ["don’t stop rock'n'roll", 3],
    ["x — y – z", 3],
    // `,` and `.` join digits only; letters and digits run together.
    ["1,000.50 and 3.14 and 1.2.3", 5],
    ["e.g. U.S.A. end.", 6],
    ["abc123 def", 2],
    // Han and kana count one each, Korean runs whole words.
    ["中文，标点。", 4],
    ["コーヒー", 4],
    ["日本語のテキスト and 한국어", 10],
    ["〇一", 1],
    // Combining marks end a word, except in Tamil.
    ["हिन्दी भाषा", 5],
    ["தமிழ் மொழி", 2],
    ["🙂🙂", 0],
  ];
  for (const [text, words] of cases) {
    assert.equal(countText(text).words, words, JSON.stringify(text));
  }
});

test("characters are the text's length, line breaks included", () => {
  assert.equal(countText("line one\nline two\n").characters, 18);
  assert.equal(countText("ab\r\ncd").characters, 5);
  assert.equal(countText("---\na: b\n---\nxy").characters, 2);
  assert.equal(countText("emoji 😀 here").characters, 13);
});

test("a selection counts its properties too", () => {
  assert.deepEqual(countText("---\na: b\n---", false), {
    words: 4,
    characters: 12,
  });
});

test("counts read like Obsidian's status bar", () => {
  assert.equal(formatCounts({ words: 1, characters: 1 }), "1 word 1 character");
  assert.equal(
    formatCounts({ words: 1200, characters: 6543 }),
    "1,200 words 6,543 characters",
  );
});

function loadWorkbench(vscode: unknown) {
  const loader = Module as typeof Module & {
    _load(id: string, ...args: unknown[]): unknown;
  };
  const originalLoad = loader._load;
  loader._load = (id, ...args) =>
    id === "vscode" ? vscode : originalLoad.call(Module, id, ...args);
  const require = createRequire(import.meta.url);
  forgetModules(require, "/src/host/", "/src/shared/");
  try {
    return require("../../../src/host/services/workbench.ts") as typeof WorkbenchService;
  } finally {
    loader._load = originalLoad;
  }
}

test("textEditor prefers the active text editor when a note is split across two text panes", () => {
  const uri = "file:///vault/Note.md";
  const text = "alpha beta gamma delta";
  const makeDocument = () => ({
    uri: { toString: () => uri },
    getText: (selection?: { from: number; to: number }) =>
      selection ? text.slice(selection.from, selection.to) : text,
  });
  const firstPane = {
    document: makeDocument(),
    selections: [{ from: 0, to: 5 }],
  };
  const secondPane = {
    document: makeDocument(),
    selections: [{ from: 6, to: 16 }],
  };
  const { createActiveEditor } = loadWorkbench({
    window: {
      activeTextEditor: secondPane,
      visibleTextEditors: [firstPane, secondPane],
      tabGroups: {
        onDidChangeTabs: () => ({ dispose() {} }),
        onDidChangeTabGroups: () => ({ dispose() {} }),
      },
      onDidChangeTextEditorSelection: () => ({ dispose() {} }),
    },
  });
  const activeEditor = createActiveEditor();
  assert.deepEqual(activeEditor.textEditor(uri), {
    text,
    selection: "beta gamma",
  });
});
