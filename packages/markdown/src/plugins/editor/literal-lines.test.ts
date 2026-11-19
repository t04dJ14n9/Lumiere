import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { indentUnit } from "@codemirror/language";
import { markdownLanguageSupport } from "../../markdown/dialect";
import { indentTab, outdentBackspace, outdentTab } from "./indentation";

type Command = typeof indentTab;

/** Runs `command` with the caret at `|` in a note parsed as Markdown. */
function apply(text: string, command: Command): string {
  const anchor = text.indexOf("|");
  let state = EditorState.create({
    doc: text.replace("|", ""),
    selection: { anchor },
    extensions: [
      markdownLanguageSupport(),
      indentUnit.of("    "),
      EditorState.tabSize.of(4),
    ],
  });
  const handled = command({
    state,
    dispatch: (tr) => {
      state = tr.state;
    },
  });
  const at = state.selection.main.head;
  const result = state.sliceDoc(0, at) + "|" + state.sliceDoc(at);
  return handled ? result : `unhandled: ${result}`;
}

const fence = (body: string) => `\`\`\`python\n${body}\n\`\`\`\nafter`;

test("Tab indents a code fence line that looks like Markdown", () => {
  for (const line of ["# comment", "---", "[key]: value", "> not a quote"]) {
    assert.equal(
      apply(fence(`x = 1\n${line}|`), indentTab),
      fence(`x = 1\n    ${line}|`),
      line,
    );
  }
  // The line above `---` is no setext title inside code.
  assert.equal(
    apply(fence("title|\n---"), indentTab),
    fence("    title|\n---"),
  );
});

test("Tab and Shift+Tab treat a `- ` code line as code, not a list item", () => {
  assert.equal(apply(fence("    - item|"), outdentTab), fence("- item|"));
  assert.equal(apply(fence("- item|"), indentTab), fence("    - item|"));
});

test("Backspace at the text start of a code line is an ordinary Backspace", () => {
  assert.equal(
    apply(fence("> |quoted"), outdentBackspace),
    `unhandled: ${fence("> |quoted")}`,
  );
  assert.equal(
    apply(fence("- |item"), outdentBackspace),
    `unhandled: ${fence("- |item")}`,
  );
});

test("a fence's own lines keep their no-op, so the fence is not broken", () => {
  assert.equal(apply("```python|\nx\n```", indentTab), "```python|\nx\n```");
  assert.equal(apply("```\nx\n```|", indentTab), "```\nx\n```|");
});

test("an unclosed fence's last line is code", () => {
  assert.equal(apply("```\n# heading|", indentTab), "```\n    # heading|");
});

test("indented code and frontmatter lines are literal; Markdown outside them is not", () => {
  assert.equal(
    apply("para\n\n    code\n    ---|", indentTab),
    "para\n\n    code\n        ---|",
  );
  assert.equal(
    apply("---\n# yaml comment|\n---\nbody", indentTab),
    "---\n    # yaml comment|\n---\nbody",
  );
  assert.equal(
    apply("---\ntitle: x|\n---\n", indentTab),
    "---\n    title: x|\n---\n",
  );
  // Outside code the Markdown rules still hold.
  assert.equal(apply("# heading|", indentTab), "# heading|");
  assert.equal(apply("text\n\n---|", indentTab), "text\n\n---|");
});
