import {
  EditorSelection,
  EditorState,
  type SelectionRange,
} from "@codemirror/state";
import { revealRanges } from "../../webview/ui/pointer-selection";
import { markdownTree } from "./api";

/**
 * A drag that starts at the start of a heading's text, while the heading's
 * `#` marks are hidden, starts at the start of the line instead, so the
 * selection takes the marks, as in Obsidian (which shows them as soon as the
 * selection is on the line). Reveal stays frozen from the press until the
 * release, so the marks stay hidden through the drag and no press could land
 * before them. Only the start of a selection moves; a click (an empty
 * selection) keeps the caret at the text.
 */
export const headingDragStart = EditorState.transactionFilter.of(
  (transaction) => {
    const selection = transaction.selection;
    if (!selection || !transaction.isUserEvent("select.pointer")) {
      return transaction;
    }
    const state = transaction.state;
    let moved = false;
    const ranges = selection.ranges.map((range) => {
      const start = range.empty
        ? undefined
        : hiddenHeadingStart(state, transaction.startState, range.from);
      if (start === undefined) {
        return range;
      }
      moved = true;
      return withStart(range, start);
    });
    return moved
      ? [
          transaction,
          { selection: EditorSelection.create(ranges, selection.mainIndex) },
        ]
      : transaction;
  },
);

function withStart(range: SelectionRange, start: number): SelectionRange {
  return range.anchor <= range.head
    ? EditorSelection.range(start, range.head)
    : EditorSelection.range(range.anchor, start);
}

/**
 * The start of `at`'s line, if `at` is where a heading's text starts and
 * its marks were hidden (no revealed range on the line) when the drag began.
 */
function hiddenHeadingStart(
  state: EditorState,
  pressed: EditorState,
  at: number,
): number | undefined {
  const line = state.doc.lineAt(at);
  const marks = /^ {0,3}#{1,6}(?:[ \t]+|$)/.exec(line.text);
  if (!marks || at !== line.from + marks[0].length) {
    return undefined;
  }
  const mark = markdownTree(state).resolveInner(
    line.from + marks[0].indexOf("#"),
    1,
  );
  if (
    mark.name !== "HeaderMark" ||
    !/^ATXHeading/.test(mark.parent?.name ?? "")
  ) {
    return undefined;
  }
  const revealed = revealRanges(pressed).some(
    (range) => range.from <= line.to && range.to >= line.from,
  );
  return revealed ? undefined : line.from;
}
