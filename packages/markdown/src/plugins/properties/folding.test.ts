import test from "node:test";
import assert from "node:assert/strict";
import { EditorState, Text, type TransactionSpec } from "@codemirror/state";
import { foldState, foldedRanges } from "@codemirror/language";
import type { Context } from "@workshop/core";
import {
  frontmatterFold,
  registerPropertyFolding,
  toggleFrontmatterFold,
} from "./folding";
import type { PropertyEditing } from "./editing";
import type { PropertyPresentation } from "./presentation";

const NOTE = "---\ntitle: A\ntags: [x]\n---\nBody\n";

function folds(state: EditorState): string[] {
  const ranges: string[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    ranges.push(`${from}-${to}`);
  });
  return ranges;
}

test("the front matter folds from the note's start through its closing line, as in Obsidian's Source mode", () => {
  assert.deepEqual(frontmatterFold(Text.of(NOTE.split("\n"))), {
    from: 0,
    to: NOTE.indexOf("---\nBody") + 3,
  });
  for (const text of [
    "Body\n---\na: 1\n---",
    "\n---\na: 1\n---",
    "---\na: 1\n...",
    "---\na: 1",
    "--- \na: 1\n---",
  ]) {
    assert.equal(frontmatterFold(Text.of(text.split("\n"))), undefined, text);
  }
});

test("Toggle Fold Properties folds the YAML, then unfolds it, only with fold state", () => {
  let state = EditorState.create({ doc: NOTE, extensions: [foldState] });
  state = state.update({ effects: toggleFrontmatterFold(state)! }).state;
  assert.deepEqual(folds(state), [`0-${NOTE.indexOf("---\nBody") + 3}`]);
  state = state.update({ effects: toggleFrontmatterFold(state)! }).state;
  assert.deepEqual(folds(state), []);
  assert.equal(
    toggleFrontmatterFold(EditorState.create({ doc: NOTE })),
    undefined,
  );
  assert.equal(
    toggleFrontmatterFold(
      EditorState.create({ doc: "# Note\n", extensions: [foldState] }),
    ),
    undefined,
  );
});

function harness(options: {
  doc: string;
  showsYaml: boolean;
  heading?: boolean;
}) {
  const commands = new Map<string, () => boolean>();
  const listeners = new Map<string, () => void>();
  const collapsed: boolean[] = [];
  let clicks = 0;
  const view = {
    state: EditorState.create({ doc: options.doc, extensions: [foldState] }),
    dispatch(spec: TransactionSpec) {
      view.state = view.state.update(spec).state;
    },
    dom: {
      querySelector: () =>
        options.heading
          ? {
              click: () => {
                clicks++;
              },
            }
          : null,
    },
  };
  const ctx = {
    editor: { view },
    effect: (setup: () => unknown) => setup(),
    commands: {
      register: (id: string, run: () => boolean) => commands.set(id, run),
    },
    on: (name: string, listener: () => void) => listeners.set(name, listener),
  } as unknown as Context;
  const editing = {
    isCollapsed: false,
    setCollapsed(value: boolean) {
      editing.isCollapsed = value;
      collapsed.push(value);
    },
  };
  registerPropertyFolding(ctx, {
    editing: editing as unknown as PropertyEditing,
    presentation: {
      showsYaml: options.showsYaml,
    } as PropertyPresentation,
  });
  return { view, commands, listeners, collapsed, clicks: () => clicks };
}

test("Toggle Fold Properties folds the YAML where it is text, and otherwise clicks the sheet's heading", () => {
  const source = harness({ doc: NOTE, showsYaml: true, heading: true });
  assert.equal(source.commands.get("editor:toggle-fold-properties")!(), true);
  assert.equal(folds(source.view.state).length, 1);
  assert.equal(source.clicks(), 0);

  const sheet = harness({ doc: NOTE, showsYaml: false, heading: true });
  assert.equal(sheet.commands.get("editor:toggle-fold-properties")!(), true);
  assert.deepEqual(folds(sheet.view.state), []);
  assert.equal(sheet.clicks(), 1);

  const none = harness({ doc: "Body", showsYaml: true });
  assert.equal(none.commands.get("editor:toggle-fold-properties")!(), false);
});

test("Fold All and Unfold All both collapse the note's Properties, as in Obsidian 1.15.0", () => {
  const note = harness({ doc: NOTE, showsYaml: false });
  note.listeners.get("folding/allCommand")!();
  note.listeners.get("folding/allCommand")!();
  assert.deepEqual(note.collapsed, [true]);

  const bare = harness({ doc: "Body", showsYaml: false });
  bare.listeners.get("folding/allCommand")!();
  assert.deepEqual(bare.collapsed, []);
});
