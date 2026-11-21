import test from "node:test";
import assert from "node:assert/strict";
import {
  EditorSelection,
  EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { markdownLanguageSupport } from "../../../src/markdown/dialect";
import { wrapSelection } from "../../../src/plugins/formatting/inline";
import {
  fenceLines,
  lineEdit,
  linkEdit,
  ruleEdit,
  tagEdit,
} from "../../../src/plugins/formatting/lines";
import { mathBlockEdit } from "../../../src/plugins/math/commands";
import { withCaretAt } from "../../../src/plugins/formatting/cursors";
import { checklistEdit } from "../../../src/plugins/tasks/edits";
import { insertTable } from "../../../src/plugins/tables/commands";
import { wikilinkEdit } from "../../../src/markdown/wikilink-edit";

// Every expected note is Obsidian's, measured by running its command on the
// same note and selection in a throwaway vault (2026-10-17). "|" is the caret;
// "‹" and "›" the selection's start and end.

function parse(doc: string): EditorState {
  let text = "";
  let anchor = 0;
  let head = 0;
  for (const char of doc) {
    if (char === "|") {
      anchor = head = text.length;
    } else if (char === "‹") {
      anchor = text.length;
    } else if (char === "›") {
      head = text.length;
    } else {
      text += char;
    }
  }
  return EditorState.create({
    doc: text,
    selection: { anchor, head },
    extensions: [markdownLanguageSupport()],
  });
}

function show(state: EditorState): string {
  const text = state.doc.toString();
  const { from, to } = state.selection.main;
  return from === to
    ? `${text.slice(0, from)}|${text.slice(from)}`
    : `${text.slice(0, from)}‹${text.slice(from, to)}›${text.slice(to)}`;
}

const edit = (doc: string, make: (state: EditorState) => TransactionSpec) => {
  const state = parse(doc);
  return show(state.update(make(state)).state);
};

const wrap = (doc: string, marker: string) => {
  let state = parse(doc);
  const view = {
    get state() {
      return state;
    },
    dispatch(spec: TransactionSpec) {
      state = state.update(spec).state;
    },
  } as unknown as EditorView;
  wrapSelection(marker)(view);
  return show(state);
};

test("bold and the other markers wrap each selected line on its own, and unwrap them", () => {
  assert.equal(wrap("‹one\ntwo›", "**"), "**‹one**\n**two›**");
  assert.equal(wrap("‹**one**\n**two**›", "**"), "‹one\ntwo›");
  assert.equal(wrap("**‹one**\n**two›**", "**"), "‹one\ntwo›");
  assert.equal(wrap("‹one\n\ntwo›", "**"), "**‹one**\n\n**two›**");
  assert.equal(wrap("o‹ne\ntw›o", "`"), "o`‹ne`\n`tw›`o");
  assert.equal(wrap("‹**one**\n**two**›", "`"), "`‹**one**`\n`**two**›`");
});

// Read from Obsidian 1.15.0's toggleMarkdownFormatting (not measured): the
// line's quote, list, task and heading markers and the selection's edge
// spaces stay outside the markers; table, code and math lines are skipped.
// Obsidian's selection keeps a selected leading marker; Lumiere's ends on
// the formatted text.
test("inline formats wrap a line's text after its markers, edge spaces outside", () => {
  assert.equal(wrap("‹- item›", "**"), "- **‹item›**");
  assert.equal(wrap("‹ hello ›", "**"), " **‹hello›** ");
  assert.equal(wrap("‹# Title›", "*"), "# *‹Title›*");
  assert.equal(wrap("‹> quote›", "~~"), "> ~~‹quote›~~");
  assert.equal(wrap("‹- [ ] task›", "`"), "- [ ] `‹task›`");
  assert.equal(wrap("‹> 1. a  \n> 2. b›", "=="), "> 1. ==‹a==  \n> 2. ==b›==");
  assert.equal(wrap("‹- **item**›", "**"), "- ‹item›");
  assert.equal(wrap("‹- a\n- b›", "**"), "- **‹a**\n- **b›**");
  assert.equal(
    wrap("‹text\n```\ncode\n```›", "**"),
    "**‹text›**\n```\ncode\n```",
  );
  assert.equal(wrap("‹- ›", "**"), "‹- ›");
});

test("inline math wraps the word at the caret, as bold does", () => {
  assert.equal(wrap("te|xt", "$"), "$te|xt$");
  assert.equal(wrap("a |b", "$"), "a $|b$");
  assert.equal(wrap("|", "$"), "$|$");
  assert.equal(wrap("‹one\ntwo›", "$"), "$‹one$\n$two›$");
});

test("headings, lists and quotes leave a caret on an empty line after their marker", () => {
  assert.equal(
    edit("|", (s) => lineEdit(s, "- ")),
    "- |",
  );
  assert.equal(
    edit("|", (s) => lineEdit(s, "1. ")),
    "1. |",
  );
  assert.equal(
    edit("|", (s) => lineEdit(s, "> ")),
    "> |",
  );
  assert.equal(
    edit("|", (s) => lineEdit(s, "# ")),
    "# |",
  );
  assert.equal(
    edit("|", (s) => lineEdit(s, "### ")),
    "### |",
  );
});

test("a list marker replaces another list's, checkbox and all, and a second press removes it", () => {
  assert.equal(
    edit("- it|em", (s) => lineEdit(s, "1. ")),
    "1. it|em",
  );
  assert.equal(
    edit("1. it|em", (s) => lineEdit(s, "1. ")),
    "it|em",
  );
  assert.equal(
    edit("1. it|em", (s) => lineEdit(s, "- ")),
    "- it|em",
  );
  assert.equal(
    edit("- it|em", (s) => lineEdit(s, "- ")),
    "it|em",
  );
  assert.equal(
    edit("- [ ] it|em", (s) => lineEdit(s, "- ")),
    "- it|em",
  );
  assert.equal(
    edit("- [ ] it|em", (s) => lineEdit(s, "1. ")),
    "1. it|em",
  );
  assert.equal(
    edit("‹one\ntwo›\nthree", (s) => lineEdit(s, "- ")),
    "- ‹one\n- two›\nthree",
  );
});

// Obsidian 1.15.0's Toggle Numbered List writes the literal "1. " on every
// selected line; the renderer numbers them. Lumiere used to renumber 1, 2, 3.
test("Toggle Numbered List writes '1. ' on every line, not 1, 2, 3", () => {
  assert.equal(
    edit("‹one\ntwo\nthree›", (s) => lineEdit(s, "1. ")),
    "1. ‹one\n1. two\n1. three›",
  );
  assert.equal(
    edit("‹> a\n> b›", (s) => lineEdit(s, "1. ")),
    "‹> 1. a\n> 1. b›",
  );
});

test("Toggle Numbered List keeps line structure and toggles every numbered marker off", () => {
  // A replaced marker leaves the selection start at column 0: Obsidian sends
  // only `{changes}`, and CodeMirror maps a position at the start of a
  // replaced range to that start. An inserted marker maps to the right of
  // itself (see the test above), which is why the two shapes differ.
  assert.equal(
    edit("‹- a\n2) b›", (s) => lineEdit(s, "1. ")),
    "‹1. a\n1. b›",
  );
  assert.equal(
    edit("‹a\n\nb›", (s) => lineEdit(s, "1. ")),
    "1. ‹a\n\n1. b›",
  );
  assert.equal(
    edit("‹> 1. a\n> 2. b›", (s) => lineEdit(s, "1. ")),
    "‹> a\n> b›",
  );
  assert.equal(
    edit("  1. nes|ted", (s) => lineEdit(s, "1. ")),
    "  nes|ted",
  );
  assert.equal(
    edit("‹1. a\n\n1. b›", (s) => lineEdit(s, "1. ")),
    "‹a\n\nb›",
  );
  assert.equal(
    edit("‹1. a\n2. b\n3. c›", (s) => lineEdit(s, "1. ")),
    "‹a\nb\nc›",
  );
  assert.equal(
    edit("1. [ ] it|em", (s) => lineEdit(s, "1. ")),
    "it|em",
  );
  assert.equal(
    edit("‹1. [ ] a\n2. b›", (s) => lineEdit(s, "1. ")),
    "‹a\nb›",
  );
});

// Obsidian 1.15.0's line commands, read from its app.js with REA
// (2026-11-07): markers go after a line's `>` and indentation, and blank
// lines in a selection of several are skipped.
test("inside a quote or callout, headings and list markers go after the `>`", () => {
  assert.equal(
    edit("> te|xt", (s) => lineEdit(s, "## ")),
    "> ## te|xt",
  );
  assert.equal(
    edit("> ### te|xt", (s) => lineEdit(s, "")),
    "> te|xt",
  );
  assert.equal(
    edit("> [!note]\n> ‹a\n> b›", (s) => lineEdit(s, "- ")),
    "> [!note]\n> - ‹a\n> - b›",
  );
  assert.equal(
    edit("‹> - a\n> - b›", (s) => lineEdit(s, "- ")),
    "‹> a\n> b›",
  );
  assert.equal(
    edit("‹> a\n> b›", (s) => lineEdit(s, "1. ")),
    "‹> 1. a\n> 1. b›",
  );
  assert.equal(
    edit("  - nes|ted", (s) => lineEdit(s, "1. ")),
    "  1. nes|ted",
  );
});

test("a quote goes on the lines without one, or one level comes off every line", () => {
  assert.equal(
    edit("‹> a\nb›", (s) => lineEdit(s, "> ")),
    "‹> a\n> b›",
  );
  assert.equal(
    edit("‹> a\n>b\n> > c›", (s) => lineEdit(s, "> ")),
    "‹a\nb\n> c›",
  );
});

test("blank lines in a selection of several lines get no list marker", () => {
  assert.equal(
    edit("‹a\n\nb›", (s) => lineEdit(s, "- ")),
    "- ‹a\n\n- b›",
  );
});

// Read from Obsidian 1.15.0's toggleBlockquote (not measured; the same in
// 1.13.7): it does not skip blank lines, so one among quoted lines is quoted
// rather than the others unquoted.
test("Toggle Blockquote quotes the blank lines of a selection of several lines", () => {
  assert.equal(
    edit("‹a\n  \nb›", (s) => lineEdit(s, "> ")),
    "> ‹a\n>   \n> b›",
  );
  assert.equal(
    edit("‹> a\n\n> b›", (s) => lineEdit(s, "> ")),
    "‹> a\n> \n> b›",
  );
  assert.equal(
    edit("‹> a\n> \n> b›", (s) => lineEdit(s, "> ")),
    "‹a\n\nb›",
  );
});

// Read from Obsidian 1.15.0 (not measured): line commands take every line
// from the selection's first to its last, whichever way it runs, the line
// it ends at the start of included.
test("line commands include the line a selection ends at the start of, either way", () => {
  assert.equal(
    edit("‹one\n›two", (s) => lineEdit(s, "- ")),
    "- ‹one\n›- two",
  );
  assert.equal(
    edit("›one\n‹two", (s) => lineEdit(s, "> ")),
    "> ‹one\n›> two",
  );
  assert.equal(
    edit("‹one\n›two", (s) => fenceLines(s, "```", "```")),
    "```\n‹one\n›two\n```",
  );
  assert.equal(
    edit("›one\n‹two", (s) => checklistEdit(s, false)),
    "- [ ] ‹one\n›- [ ] two",
  );
});

test("a horizontal rule goes on a line of its own, the caret on the line after", () => {
  assert.equal(edit("|", ruleEdit), "\n---\n|");
  assert.equal(edit("above\n|\nbelow", ruleEdit), "above\n\n---\n|\nbelow");
  assert.equal(edit("te|xt", ruleEdit), "te\n\n---\n|xt");
  assert.equal(
    edit("above\n‹one\ntwo›\nbelow", ruleEdit),
    "above\n\n---\n|\nbelow",
  );
});

test("cycling a line goes text, bullet, [ ], [x], bullet", () => {
  let doc = "te|xt";
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    doc = edit(doc, (s) => checklistEdit(s, true));
    seen.push(doc);
  }
  assert.deepEqual(seen, ["- te|xt", "- [ ] te|xt", "- [x] te|xt", "- te|xt"]);
  assert.equal(
    edit("1. it|em", (s) => checklistEdit(s, true)),
    "1. [ ] it|em",
  );
  // Toggle checkbox status still makes plain text a task at once.
  assert.equal(
    edit("te|xt", (s) => checklistEdit(s, false)),
    "- [ ] te|xt",
  );
});

// Obsidian 1.15.0's Toggle checkbox status and Cycle list checklist, read
// from its app.js with REA (2026-11-07): the selected lines move together to
// the step after the least advanced one, and blank lines in a selection of
// several are skipped.
test("several tasks are checked together while any is open, then opened together", () => {
  assert.equal(
    edit("‹- [ ] a\n- [x] b›", (s) => checklistEdit(s, false)),
    "‹- [x] a\n- [x] b›",
  );
  assert.equal(
    edit("‹- [/] a\n- [ ] b›", (s) => checklistEdit(s, false)),
    "‹- [x] a\n- [x] b›",
  );
  assert.equal(
    edit("‹- [x] a\n- [-] b›", (s) => checklistEdit(s, false)),
    "‹- [ ] a\n- [ ] b›",
  );
  assert.equal(
    edit("‹- [ ] a\n- [x] b›", (s) => checklistEdit(s, true)),
    "‹- [x] a\n- [x] b›",
  );
  assert.equal(
    edit("‹- [x] a\n- [x] b›", (s) => checklistEdit(s, true)),
    "‹- a\n- b›",
  );
});

test("lines without a box catch up with the selection's tasks, which keep theirs", () => {
  // Obsidian drops the tasks' boxes here; Lumiere keeps them.
  assert.equal(
    edit("‹a\n- [x] b›", (s) => checklistEdit(s, false)),
    "- [ ] ‹a\n- [x] b›",
  );
  assert.equal(
    edit("‹a\n- b\n- [ ] c›", (s) => checklistEdit(s, true)),
    "- ‹a\n- b\n- [ ] c›",
  );
  assert.equal(
    edit("‹- a\n- [x] c›", (s) => checklistEdit(s, true)),
    "‹- [ ] a\n- [x] c›",
  );
});

test("blank lines in a selection of several lines get no box", () => {
  assert.equal(
    edit("‹a\n\nb›", (s) => checklistEdit(s, false)),
    "- [ ] ‹a\n\n- [ ] b›",
  );
  assert.equal(
    edit("‹a\n  \nb›", (s) => checklistEdit(s, true)),
    "- ‹a\n  \n- b›",
  );
});

test("a selection of a very large number of lines does not overflow the call stack", () => {
  // Spreading one argument per line into Math.min fails above ~125k lines.
  const count = 200_000;
  const doc = Array.from({ length: count }, () => "a").join("\n");
  const state = EditorState.create({
    doc,
    selection: { anchor: 0, head: doc.length },
  });
  const next = state.update(checklistEdit(state, false)).state;
  assert.equal(next.doc.lines, count);
  assert.equal(next.doc.line(1).text, "- [ ] a");
  assert.equal(next.doc.line(count).text, "- [ ] a");
});

test("a new table goes after the line the selection starts on, the caret at its start", () => {
  const table = "|     |     |\n| --- | --- |\n|     |     |";
  assert.equal(edit("|", insertTable), `\n|${table}\n`);
  assert.equal(
    edit("above\n|\nbelow", insertTable),
    `above\n\n|${table}\n\nbelow`,
  );
  assert.equal(edit("te|xt\n", insertTable), `text\n\n|${table}\n\n`);
  assert.equal(
    edit("above\n‹one\ntwo›\nbelow", insertTable),
    `above\none\n\n|${table}\n\ntwo\nbelow`,
  );
});

test("code blocks fence the selected lines, and Insert Tag types # before the selection", () => {
  const fence = (s: EditorState) => fenceLines(s, "```", "```");
  assert.equal(edit("|", fence), "```\n|\n```");
  assert.equal(edit("above\n|\nbelow", fence), "above\n```\n|\n```\nbelow");
  assert.equal(edit("‹one\ntwo›", fence), "```\n‹one\ntwo›\n```");
  assert.equal(edit("te|xt", tagEdit), "te#|xt");
  assert.equal(edit("a ‹word› b", tagEdit), "a #|word b");
});

// Obsidian 1.15.0's Insert Wikilink, Insert Embed and Insert Tag, read from
// its app.js with REA (2026-11-07): each marks its edit `input.autocomplete`,
// which opens the suggester at once.
test("Insert Wikilink and Insert Embed wrap the selection, the caret after it", () => {
  assert.equal(
    edit("te|xt", (s) => wikilinkEdit(s, false)),
    "te[[|]]xt",
  );
  assert.equal(
    edit("a ‹note› b", (s) => wikilinkEdit(s, false)),
    "a [[note|]] b",
  );
  assert.equal(
    edit("‹pic.png›", (s) => wikilinkEdit(s, true)),
    "![[pic.png|]]",
  );
});

test("Insert Wikilink, Insert Embed and Insert Tag ask for suggestions", () => {
  const state = parse("|");
  assert.equal(wikilinkEdit(state, false).userEvent, "input.autocomplete");
  assert.equal(wikilinkEdit(state, true).userEvent, "input.autocomplete");
  assert.equal(tagEdit(state).userEvent, "input.autocomplete");
});

test("an added caret becomes the main one, and carets stay in order", () => {
  const state = parse("o|ne\ntwo\nthree").update({}).state;
  const multi = EditorState.create({
    doc: state.doc,
    selection: state.selection,
    extensions: EditorState.allowMultipleSelections.of(true),
  });
  const next = withCaretAt(multi.selection, 5);
  assert.deepEqual(
    next.ranges.map((range) => range.head),
    [1, 5],
  );
  assert.equal(next.main.head, 5);
  const above = withCaretAt(
    EditorSelection.create([EditorSelection.cursor(10)]),
    6,
  );
  assert.deepEqual(
    above.ranges.map((range) => range.head),
    [6, 10],
  );
  assert.equal(above.main.head, 6);
});

test("an unclosed %% block keeps the note's last characters when its markers are removed", async () => {
  const { clearInlineFormatting } =
    await import("../../../src/plugins/formatting/inline");
  const { toggleComment } =
    await import("../../../src/plugins/formatting/comment");
  assert.equal(clearInlineFormatting("%%\ndraft text"), "\ndraft text");
  assert.equal(clearInlineFormatting("%%\ndraft\n%%"), "\ndraft\n");
  const state = EditorState.create({
    doc: "%%\ndraft text",
    selection: { anchor: 5 },
    extensions: [markdownLanguageSupport()],
  });
  const spec = toggleComment(state);
  assert.equal(state.update(spec).state.doc.toString(), "\ndraft text");
});

/** `doc` with a caret at each "|", as several selections. */
function carets(doc: string): EditorState {
  const heads: number[] = [];
  let text = "";
  for (const char of doc) {
    if (char === "|") {
      heads.push(text.length);
    } else {
      text += char;
    }
  }
  return EditorState.create({
    doc: text,
    selection: EditorSelection.create(
      heads.map((head) => EditorSelection.cursor(head)),
    ),
    extensions: [
      markdownLanguageSupport(),
      EditorState.allowMultipleSelections.of(true),
    ],
  });
}

function showCarets(state: EditorState): string {
  let text = state.doc.toString();
  for (const range of [...state.selection.ranges].reverse()) {
    text = `${text.slice(0, range.head)}|${text.slice(range.head)}`;
  }
  return text;
}

const atEveryCaret = (
  doc: string,
  make: (state: EditorState) => TransactionSpec,
) => {
  const state = carets(doc);
  return showCarets(state.update(make(state)).state);
};

// Read from Obsidian 1.15.0 (not measured): line commands take the lines of
// every selection range, and Insert Link, Wikilink, Embed, Horizontal Rule,
// Code Block and Math Block edit at every selection.
test("line and insert commands act at every caret", () => {
  const twoLines = "o|ne\ntwo\nth|ree";
  assert.equal(
    atEveryCaret(twoLines, (s) => lineEdit(s, "- ")),
    "- o|ne\ntwo\n- th|ree",
  );
  assert.equal(
    atEveryCaret(twoLines, (s) => lineEdit(s, "## ")),
    "## o|ne\ntwo\n## th|ree",
  );
  assert.equal(
    atEveryCaret(twoLines, (s) => checklistEdit(s, false)),
    "- [ ] o|ne\ntwo\n- [ ] th|ree",
  );
  assert.equal(
    atEveryCaret("o|ne\ntw|o", (s) => fenceLines(s, "```", "```")),
    "```\no|ne\n```\n```\ntw|o\n```",
  );
  assert.equal(
    atEveryCaret("o|ne\ntw|o", mathBlockEdit),
    "$$\no|ne\n$$\n$$\ntw|o\n$$",
  );
  assert.equal(atEveryCaret("a| b|", linkEdit), "a[|]() b[|]()");
  assert.equal(
    atEveryCaret("a| b|", (s) => wikilinkEdit(s, true)),
    "a![[|]] b![[|]]",
  );
  assert.equal(
    atEveryCaret("a|b\nc|d", ruleEdit),
    "a\n\n---\n|b\nc\n\n---\n|d",
  );
});

test("two carets on blank lines count as a selection of several lines", () => {
  // Obsidian skips blank lines among several, the lines of every caret
  // counted together, so a list marker goes on neither.
  assert.equal(
    atEveryCaret("|\n\n|", (s) => lineEdit(s, "- ")),
    "|\n\n|",
  );
});
