import { moveLineDown, moveLineUp } from "@codemirror/commands";
import {
  EditorSelection,
  type ChangeSpec,
  type EditorState,
  type TransactionSpec,
} from "@codemirror/state";
import type { Command } from "@codemirror/view";
import { smartListsOn } from "../../markdown/smart-lists";
import {
  LIST_LINE,
  listBlockAt,
  neighbourOf,
  type ListBlock,
} from "./list-blocks";

type Step = 1 | -1;

/**
 * Swap Line Up and Down, as in Obsidian 1.15: with Smart lists on and one
 * selection on list items, the items move whole, with the lines under them
 * (`listSwap`); otherwise CodeMirror moves the selected lines.
 */
export function swapLine(step: Step): Command {
  const moveLines = step < 0 ? moveLineUp : moveLineDown;
  return (view) => {
    const swap = listSwap(view.state, step);
    if (swap === "lines") {
      return moveLines(view);
    }
    if (view.state.readOnly) {
      return false;
    }
    if (swap) {
      view.dispatch(swap);
    }
    return true;
  };
}

/**
 * The list move for the selection, as Obsidian 1.15 makes it: the selected
 * items (one, or siblings in a row) swap with the sibling before or after
 * them, or with a paragraph line; next to a shallower item they move out to
 * the end of the parent's previous sibling (up), or in as the first child of
 * the parent's next sibling (down). A number takes the place's number.
 * `"lines"` when this is no list move (Smart lists off, several selections,
 * not on a list item), `undefined` when the items cannot move that way.
 */
export function listSwap(
  state: EditorState,
  step: Step,
): TransactionSpec | "lines" | undefined {
  if (!state.facet(smartListsOn) || state.selection.ranges.length > 1) {
    return "lines";
  }
  const block = selectedItems(state);
  if (!block) {
    return "lines";
  }
  const start = step < 0 ? block.fromLine - 1 : block.toLine + 1;
  const next = neighbourOf(state, start, step, block);
  if (next.kind === "sibling") {
    return swapBlocks(state, block, next.block, step);
  }
  if (next.kind === "shallower") {
    return step < 0
      ? moveOut(state, block, next.block)
      : moveIn(state, block, next.block);
  }
  if (next.kind === "paragraph") {
    return swapBlocks(state, block, { fromLine: start, toLine: start }, step);
  }
  return undefined;
}

/**
 * The item the selection starts on, grown over the siblings that follow it
 * until it holds the selection's last line; undefined when the selection
 * starts off an item or runs past its siblings.
 */
function selectedItems(state: EditorState): ListBlock | undefined {
  const { from, to, empty } = state.selection.main;
  const end = state.doc.lineAt(to);
  const last = !empty && to === end.from ? end.number - 1 : end.number;
  let block = listBlockAt(state, state.doc.lineAt(from).number);
  while (block && block.toLine < last) {
    const next = neighbourOf(state, block.toLine + 1, 1, block);
    if (next.kind !== "sibling") {
      return undefined;
    }
    if (next.block.fromLine > last) {
      break;
    }
    block = { ...block, toLine: next.block.toLine };
  }
  return block;
}

/** `text` with the list number of `source`'s first line, if both have one. */
function withNumberOf(text: string, source: string): string {
  const number = LIST_LINE.exec(source)![4];
  const [, prefix = "", , , own] = LIST_LINE.exec(text)!;
  if (!number || !own) {
    return text;
  }
  return (
    text.slice(0, prefix.length) +
    number +
    text.slice(prefix.length + own.length)
  );
}

/**
 * Where a position in `text` (at `from`) lands once it is written as
 * `moved` at `to`: the same place in the text, and a position in the list
 * markup stays in the markup when the number's length changes.
 */
function follow(
  { from, text }: { from: number; text: string },
  { to, moved }: { to: number; moved: string },
): (position: number) => number {
  const grown = moved.length - text.length;
  const markup = LIST_LINE.exec(text)![0].length;
  return (position) => {
    const offset = Math.min(Math.max(position - from, 0), text.length);
    return (
      to +
      (offset >= markup ? offset + grown : Math.min(offset, markup + grown))
    );
  };
}

interface LineSpan {
  fromLine: number;
  toLine: number;
}

/** The moving block and `other` change places, each keeping the place's number. */
function swapBlocks(
  state: EditorState,
  block: LineSpan,
  other: LineSpan,
  step: Step,
): TransactionSpec {
  const { doc } = state;
  const [first, second] = step < 0 ? [other, block] : [block, other];
  const firstFrom = doc.line(first.fromLine).from;
  const firstTo = doc.line(first.toLine).to;
  const secondFrom = doc.line(second.fromLine).from;
  const secondTo = doc.line(second.toLine).to;
  const firstText = doc.sliceString(firstFrom, firstTo);
  const secondText = doc.sliceString(secondFrom, secondTo);
  const upper = withNumberOf(secondText, firstText);
  const lower = withNumberOf(firstText, secondText);
  const place =
    step < 0
      ? follow(
          { from: secondFrom, text: secondText },
          { to: firstFrom, moved: upper },
        )
      : follow(
          { from: firstFrom, text: firstText },
          {
            to: firstFrom + upper.length + (secondFrom - firstTo),
            moved: lower,
          },
        );
  return moved(state, place, [
    { from: firstFrom, to: firstTo, insert: upper },
    { from: secondFrom, to: secondTo, insert: lower },
  ]);
}

/**
 * Up past its parent: the block goes before the parent, as it is, so it
 * ends the parent's previous sibling; the sibling after it takes its number.
 */
function moveOut(
  state: EditorState,
  block: ListBlock,
  parent: ListBlock,
): TransactionSpec | undefined {
  const { doc } = state;
  if (
    parent.indent !== block.indent - 1 ||
    neighbourOf(state, parent.fromLine - 1, -1, parent).kind !== "sibling"
  ) {
    return undefined;
  }
  const from = doc.line(block.fromLine).from;
  const to = doc.line(block.toLine).to;
  const text = doc.sliceString(from, to);
  const destination = doc.line(parent.fromLine).from;
  const changes: ChangeSpec[] = [
    { from: destination, insert: `${text}\n` },
    to === doc.length ? { from: from - 1, to } : { from, to: to + 1 },
  ];
  const after = neighbourOf(state, block.toLine + 1, 1, block);
  if (after.kind === "sibling") {
    const line = doc.line(after.block.fromLine);
    changes.push({
      from: line.from,
      to: line.to,
      insert: withNumberOf(line.text, text),
    });
  }
  const place = follow({ from, text }, { to: destination, moved: text });
  return moved(state, place, changes);
}

/**
 * Down past its parent's end: the block becomes the first child of the
 * item after (`next`, one level up), numbered as that child was, or `1.`
 * when it has none.
 */
function moveIn(
  state: EditorState,
  block: ListBlock,
  next: ListBlock,
): TransactionSpec | undefined {
  if (next.indent !== block.indent - 1) {
    return undefined;
  }
  const { doc } = state;
  const from = doc.line(block.fromLine).from;
  const to = doc.line(block.toLine).to;
  const text = doc.sliceString(from, to);
  const removed = to + 1 - from;
  const child = firstChildLine(state, next);
  const written = withNumberOf(text, child ? doc.line(child).text : "1. ");
  const remove = { from, to: to + 1 };
  if (child) {
    const at = doc.line(child).from;
    const place = follow({ from, text }, { to: at - removed, moved: written });
    return moved(state, place, [remove, { from: at, insert: `${written}\n` }]);
  }
  const end = doc.line(next.toLine).to;
  const place = follow(
    { from, text },
    { to: end - removed + 1, moved: written },
  );
  return moved(state, place, [remove, { from: end, insert: `\n${written}` }]);
}

/** The first list item line under `parent`'s own, in the same quotes. */
function firstChildLine(
  state: EditorState,
  parent: ListBlock,
): number | undefined {
  for (let n = parent.fromLine + 1; n <= parent.toLine; n++) {
    if (listBlockAt(state, n)?.quotes === parent.quotes) {
      return n;
    }
  }
  return undefined;
}

/** The move's transaction, the selection following the moved block. */
function moved(
  state: EditorState,
  place: (position: number) => number,
  changes: ChangeSpec[],
): TransactionSpec {
  const { anchor, head } = state.selection.main;
  return {
    changes: state.changes(changes),
    selection: EditorSelection.single(place(anchor), place(head)),
    scrollIntoView: true,
    userEvent: "move.line",
  };
}
