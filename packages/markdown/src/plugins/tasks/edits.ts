import type { EditorState, Line, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { lineMarkup } from "../../markdown/list-markup";
import { selectionTouchesTableCell } from "../../markdown/table-cell";
import { taskMarker } from "../../markdown/tasks";
import type { TextEdit } from "../../shared/host";
export function taskEdit(
  text: string,
  lineNumber: number,
  expected: string,
  checked: boolean,
): TextEdit | undefined {
  if (!Number.isSafeInteger(lineNumber) || lineNumber < 0) {
    return undefined;
  }
  const lines = text.split("\n");
  const line = lines[lineNumber];
  if (line === undefined || !isSameTaskLine(line, expected)) {
    return undefined;
  }
  const marker = taskMarker(line);
  if (marker === undefined) {
    return undefined;
  }
  const from =
    lines.slice(0, lineNumber).reduce((sum, line) => sum + line.length + 1, 0) +
    marker;
  return { from, to: from + 1, insert: checked ? "x" : " " };
}
/**
 * Whether the source line is still the line a checkbox was drawn from. An
 * embedded list item's children are shown with the item's indentation
 * removed (`extractBlocks`), so only the indentation may differ.
 */
function isSameTaskLine(line: string, expected: string): boolean {
  return line === expected || line.trimStart() === expected.trimStart();
}

/**
 * How far along the checklist a line is, in order. Cycling goes text,
 * bullet, open, done, bullet; toggling the status treats text as a bullet,
 * giving it a bullet and a box at once.
 */
const STEPS = ["text", "bullet", "open", "done"] as const;
type Step = (typeof STEPS)[number];

/**
 * Toggle Checkbox Status and Cycle List Checklist, as in Obsidian: the
 * selected lines move together to the step after the least advanced one.
 * Every task is checked while any is open; once all are done they open
 * again, or lose their boxes when cycling. Lines behind join the others,
 * which stay as they are (Obsidian drops their boxes). Blank lines in a
 * selection of several are left alone. A selection ending at column zero
 * does not include that line.
 */
export function checklistEdit(
  state: EditorState,
  cycle: boolean,
): TransactionSpec {
  const lines = selectedLines(state);
  // A loop, not Math.min(...), which throws a RangeError for a selection of
  // more than about 125,000 lines.
  let least = STEPS.length - 1;
  for (const line of lines) {
    least = Math.min(least, STEPS.indexOf(stepOf(line.text, cycle)));
  }
  const step = STEPS[least]!;
  const changes = lines.flatMap((line) => stepEdit(line, step, cycle) ?? []);
  // A caret where the box goes ends up after it, as in Obsidian.
  const set = state.changes(changes);
  return {
    changes: set,
    selection: state.selection.map(set, 1),
    userEvent: "input.checklist",
  };
}

/**
 * Run the checklist edit as an editor command. Obsidian's check callback
 * refuses both commands in a table cell, so nothing is edited there.
 */
export function runChecklist(view: EditorView, cycle: boolean): boolean {
  if (selectionTouchesTableCell(view.state)) {
    return false;
  }
  view.dispatch(checklistEdit(view.state, cycle));
  return true;
}

function selectedLines(state: EditorState): Line[] {
  const { from, to, empty } = state.selection.main;
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(empty ? to : Math.max(from, to - 1)).number;
  const lines = Array.from({ length: last - first + 1 }, (_, index) =>
    state.doc.line(first + index),
  );
  return lines.length > 1 ? lines.filter((line) => line.text.trim()) : lines;
}

function stepOf(text: string, cycle: boolean): Step {
  const box = taskMarker(text);
  if (box !== undefined) {
    return text[box] === " " ? "open" : "done";
  }
  return cycle && !lineMarkup(text).marker ? "text" : "bullet";
}

/**
 * The edit that takes `line` to the step after the selection's `step`, or
 * none when the line is already past it.
 */
function stepEdit(
  line: Line,
  step: Step,
  cycle: boolean,
): TextEdit | undefined {
  const box = taskMarker(line.text);
  if (box === undefined) {
    // After the list marker, or else after the quotes and indentation, as
    // in Obsidian (a heading's # stays after the new box).
    const { quotes, marker } = lineMarkup(line.text);
    if (step === "text" && marker) {
      return undefined;
    }
    const at = line.from + quotes.length + marker.length;
    const bullet = marker ? "" : "- ";
    const insert = step === "text" ? bullet : `${bullet}[ ] `;
    return { from: at, to: at, insert };
  }
  const at = line.from + box;
  if (step === "done" && cycle) {
    const space = line.text[box + 2] === " " ? 1 : 0;
    return { from: at - 1, to: at + 2 + space, insert: "" };
  }
  if (step === "open" || step === "done") {
    return { from: at, to: at + 1, insert: step === "open" ? "x" : " " };
  }
  return undefined;
}
