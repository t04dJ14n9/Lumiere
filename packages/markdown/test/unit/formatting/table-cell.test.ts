import test from "node:test";
import assert from "node:assert/strict";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  isInTableCell,
  selectionTouchesTableCell,
} from "../../../src/markdown/table-cell";
import { formattingCommands } from "../../../src/plugins/formatting/webview";

const TABLE = "| a | b |\n| --- | --- |\n| c | d |";
const WITH_TEXT = `${TABLE}\n\nafter text`;

// Obsidian's inTableCell check covers these block commands. The formatting
// layer owns the list, quote and code-block ones; the callouts and tasks
// plugins refuse Insert Callout and the checklist commands with the same
// predicate (their own tests).
const REFUSED = [
  "editor:toggle-bullet-list",
  "editor:toggle-numbered-list",
  "editor:toggle-blockquote",
  "editor:insert-codeblock",
];

function state(
  doc: string,
  anchor: number,
  head: number = anchor,
): EditorState {
  return EditorState.create({ doc, selection: { anchor, head } });
}

/** A view that just records whether a command dispatched an edit. */
function fakeView(initial: EditorState): {
  view: EditorView;
  dispatched: () => boolean;
} {
  let current = initial;
  let didDispatch = false;
  const view = {
    get state() {
      return current;
    },
    dispatch(spec: Parameters<EditorState["update"]>[0]) {
      didDispatch = true;
      current = current.update(spec).state;
    },
  } as unknown as EditorView;
  return { view, dispatched: () => didDispatch };
}

test("isInTableCell is true anywhere on a table row and false outside it", () => {
  // A header cell, a body cell and the separator row are all table positions.
  assert.equal(isInTableCell(state(TABLE, TABLE.indexOf("a"))), true);
  assert.equal(isInTableCell(state(TABLE, TABLE.indexOf("c"))), true);
  assert.equal(isInTableCell(state(TABLE, TABLE.indexOf("---"))), true);
  // A caret in a paragraph after the table and in plain text are not.
  assert.equal(
    isInTableCell(state(WITH_TEXT, WITH_TEXT.indexOf("after"))),
    false,
  );
  assert.equal(isInTableCell(state("hello world", 3)), false);
  assert.equal(isInTableCell(state("", 0)), false);
});

test("isInTableCell accepts an explicit position overriding the caret", () => {
  const outside = state(WITH_TEXT, WITH_TEXT.indexOf("after"));
  assert.equal(isInTableCell(outside), false);
  assert.equal(isInTableCell(outside, TABLE.indexOf("c")), true);
});

test("the list, quote and code-block commands refuse inside a table cell", () => {
  const commands = formattingCommands();
  const caret = TABLE.indexOf("c");
  for (const id of REFUSED) {
    const { view, dispatched } = fakeView(state(TABLE, caret));
    assert.equal(commands.get(id)!(view), false, `${id} returns false`);
    assert.equal(dispatched(), false, `${id} dispatches no edit`);
  }
});

test("the same commands still run outside a table cell", () => {
  const commands = formattingCommands();
  for (const id of REFUSED) {
    const { view, dispatched } = fakeView(state("hello", 3));
    assert.equal(commands.get(id)!(view), true, `${id} returns true`);
    assert.equal(dispatched(), true, `${id} dispatches its edit`);
  }
});

test("the predicate follows the parser through code fences and table variants", () => {
  const fence = "```md\n| a | b |\n| - | - |\n| c | d |\n```";
  assert.equal(isInTableCell(state(fence, fence.indexOf("c"))), false);
  const bare = "a | b\n--- | ---\nc | d";
  assert.equal(isInTableCell(state(bare, bare.indexOf("d"))), true);
  const list = "- item\n\n  | a | b |\n  | - | - |\n  | c | d |";
  assert.equal(isInTableCell(state(list, list.indexOf("d"))), true);
  const cell = "| a | b |\n| --- | --- |\n| one<br>two | `x\\|y` |";
  assert.equal(isInTableCell(state(cell, cell.indexOf("two"))), true);
  assert.equal(isInTableCell(state(cell, cell.indexOf("y"))), true);
  const ended = "| a | b |\n| - | - |\n| c | d |\nbelow";
  assert.equal(isInTableCell(state(ended, ended.indexOf("below"))), false);
});

test("a selection with one end in a table cell refuses the commands either way", () => {
  const commands = formattingCommands();
  const inside = WITH_TEXT.indexOf("c");
  const outside = WITH_TEXT.indexOf("after");
  for (const { anchor, head } of [
    { anchor: inside, head: outside },
    { anchor: outside, head: inside },
  ]) {
    for (const id of REFUSED) {
      const { view, dispatched } = fakeView(state(WITH_TEXT, anchor, head));
      assert.equal(commands.get(id)!(view), false, `${id} returns false`);
      assert.equal(dispatched(), false, `${id} dispatches no edit`);
    }
  }
});

test("selectionTouchesTableCell looks at the head and at the lower end", () => {
  const inside = WITH_TEXT.indexOf("c");
  const outside = WITH_TEXT.indexOf("after");
  assert.equal(selectionTouchesTableCell(state(WITH_TEXT, inside)), true);
  assert.equal(selectionTouchesTableCell(state(WITH_TEXT, outside)), false);
  assert.equal(
    selectionTouchesTableCell(state(WITH_TEXT, inside, outside)),
    true,
  );
  assert.equal(
    selectionTouchesTableCell(state(WITH_TEXT, outside, inside)),
    true,
  );
});

test("a caret at the end of a table's last row is in the table", () => {
  assert.equal(isInTableCell(state(TABLE, TABLE.length)), true);
  assert.equal(isInTableCell(state(WITH_TEXT, TABLE.length)), true);
  assert.equal(isInTableCell(state(WITH_TEXT, TABLE.length + 1)), false);
});

function multiState(
  doc: string,
  ranges: [number, number][],
  main: number,
): EditorState {
  return EditorState.create({
    doc,
    selection: EditorSelection.create(
      ranges.map(([anchor, head]) => EditorSelection.range(anchor, head)),
      main,
    ),
    extensions: [EditorState.allowMultipleSelections.of(true)],
  });
}

test("a secondary caret in a table cell refuses the block commands, whichever range is main", () => {
  const commands = formattingCommands();
  const cell = WITH_TEXT.indexOf("c");
  const prose = WITH_TEXT.indexOf("after");
  const orders = [
    multiState(
      WITH_TEXT,
      [
        [cell, cell],
        [prose, prose],
      ],
      1,
    ),
    multiState(
      WITH_TEXT,
      [
        [prose, prose],
        [cell, cell],
      ],
      0,
    ),
  ];
  for (const initial of orders) {
    assert.equal(selectionTouchesTableCell(initial), true);
    for (const id of REFUSED) {
      const { view, dispatched } = fakeView(initial);
      assert.equal(commands.get(id)!(view), false, `${id} returns false`);
      assert.equal(dispatched(), false, `${id} dispatches no edit`);
    }
  }
});

test("two carets in the prose line still run a block command", () => {
  const commands = formattingCommands();
  const first = WITH_TEXT.indexOf("after");
  const initial = multiState(
    WITH_TEXT,
    [
      [first, first],
      [first + 2, first + 2],
    ],
    0,
  );
  const { view, dispatched } = fakeView(initial);
  assert.equal(commands.get("editor:toggle-bullet-list")!(view), true);
  assert.equal(dispatched(), true);
  assert.equal(view.state.doc.toString(), `${TABLE}\n\n- after text`);
});

test("a selection that spans a table refuses the line commands, and the prose on either side still runs", () => {
  const commands = formattingCommands();
  const doc = `before\n\n${TABLE}\n\nafter`;
  for (const id of REFUSED) {
    const spanning = fakeView(state(doc, 0, doc.length));
    assert.equal(commands.get(id)!(spanning.view), false, `${id} refuses`);
    assert.equal(spanning.dispatched(), false, `${id} dispatches no edit`);
  }
  // Controls: the line before the table, up to the blank line before it, and the
  // line after the table, still run.
  const blankBefore = doc.indexOf("\n\n") + 1;
  const controls: [number, number][] = [
    [0, "before".length],
    [0, blankBefore],
    [doc.indexOf("after"), doc.length],
  ];
  for (const [anchor, head] of controls) {
    const { view, dispatched } = fakeView(state(doc, anchor, head));
    assert.equal(commands.get("editor:toggle-bullet-list")!(view), true);
    assert.equal(dispatched(), true);
  }
});

test("a secondary range that spans a table refuses while the main caret is in prose", () => {
  const commands = formattingCommands();
  const doc = `before\n\n${TABLE}\n\nafter`;
  const prose = doc.indexOf("after");
  const spanning = [
    multiState(
      doc,
      [
        [0, doc.length],
        [prose, prose],
      ],
      1,
    ),
    multiState(
      doc,
      [
        [prose, prose],
        [0, doc.length],
      ],
      0,
    ),
  ];
  for (const initial of spanning) {
    for (const id of REFUSED) {
      const { view, dispatched } = fakeView(initial);
      assert.equal(commands.get(id)!(view), false, `${id} refuses`);
      assert.equal(dispatched(), false, `${id} dispatches no edit`);
    }
  }
});

test("the guard matches Obsidian's list: headings are not refused", () => {
  const commands = formattingCommands();
  const { view, dispatched } = fakeView(state(TABLE, TABLE.indexOf("c")));
  assert.notEqual(commands.get("editor:set-heading-2")!(view), false);
  assert.equal(dispatched(), true);
});
