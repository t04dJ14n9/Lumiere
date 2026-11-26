import type { EditorState, TransactionSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { opensWithCalloutMarker } from "../../markdown/callout-marker";
import { selectionTouchesTableCell } from "../../markdown/table-cell";
/** Whether a quote opens with a callout's `[!type]` (see `opensWithCalloutMarker`). */
export function isCallout(source: string): boolean {
  return opensWithCalloutMarker(source);
}
/**
 * Insert Callout, as in Obsidian: with a collapsed caret that only whitespace
 * precedes on its line, insert `\n> [!NOTE] Title\n> Contents\n` at the
 * caret, so the rest of the line stays below the callout (an empty line gets
 * the template alone); otherwise, with a selection or text before the caret,
 * wrap the selected lines in a note callout with a blank line between it and
 * any text above or below. The callout's type is selected. A wrapped
 * selection ending at the start of a line includes that line, as in
 * Obsidian.
 */
export function insertCallout(state: EditorState): TransactionSpec {
  const { from, empty } = state.selection.main;
  const beforeCaret = state.sliceDoc(state.doc.lineAt(from).from, from);
  return empty && beforeCaret.trim() === ""
    ? insertTemplate(from)
    : wrapSelectedLines(state);
}

/** Quote the selected lines under `> [!NOTE]`, apart from text around them. */
function wrapSelectedLines(state: EditorState): TransactionSpec {
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from);
  const last = state.doc.lineAt(to);
  const touches = (n: number) =>
    n >= 1 && n <= state.doc.lines && state.doc.line(n).text.trim() !== "";
  const before = touches(first.number - 1) ? "\n" : "";
  const after = touches(last.number + 1) ? "\n" : "";
  const quoted = state
    .sliceDoc(first.from, last.to)
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const type = first.from + before.length + "> [!".length;
  return {
    changes: {
      from: first.from,
      to: last.to,
      insert: `${before}> [!NOTE]\n${quoted}${after}`,
    },
    selection: { anchor: type, head: type + "NOTE".length },
    userEvent: "input.callout",
  };
}

/**
 * Run Insert Callout as an editor command. Obsidian's check callback refuses
 * it in a table cell, so nothing is edited there, nor in a read-only editor.
 */
export function insertCalloutCommand(view: EditorView): boolean {
  // Insert Callout edits only the main selection, so only its ends count.
  if (
    view.state.readOnly ||
    selectionTouchesTableCell(view.state, [view.state.selection.main])
  ) {
    return false;
  }
  view.dispatch(insertCallout(view.state));
  return true;
}

/**
 * Insert Obsidian's Title/Contents template at the caret. Its leading newline
 * moves what follows the caret below the callout.
 */
function insertTemplate(at: number): TransactionSpec {
  const template = "\n> [!NOTE] Title\n> Contents\n";
  const type = at + "\n> [!".length;
  return {
    changes: { from: at, insert: template },
    selection: { anchor: type, head: type + "NOTE".length },
    userEvent: "input.callout",
  };
}
