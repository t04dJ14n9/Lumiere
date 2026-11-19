import {
  EditorSelection,
  Prec,
  type EditorState,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { continuationPrefix, lineMarkup } from "../../markdown/list-markup";

/**
 * Markdown pairing that CodeMirror's bracket closing cannot express, as
 * Obsidian's Auto pair Markdown syntax does it.
 */

/** Characters that wrap a selection, but insert alone without one. */
const WRAP_ONLY: readonly string[] = ["=", "~", "$", "%"];

/** Typing one of `WRAP_ONLY` over selections wraps each, keeping it selected. */
export function wrapOnly(
  state: EditorState,
  text: string,
): TransactionSpec | undefined {
  const { ranges } = state.selection;
  if (!WRAP_ONLY.includes(text) || ranges.some((range) => range.empty)) {
    return undefined;
  }
  return {
    ...state.changeByRange((range) => ({
      changes: [
        { from: range.from, insert: text },
        { from: range.to, insert: text },
      ],
      range: EditorSelection.range(range.anchor + 1, range.head + 1),
    })),
    userEvent: "input.type",
  };
}

/**
 * The third backtick opens a code fence and closes it on the next line,
 * which keeps the line's quotes and list indentation. Backticks after the
 * third are typed as they are. A fence opens a line (after its quotes and
 * list marker), as Obsidian documents code blocks: after other text on the
 * line, backticks are inline code, and a closing fence written below would
 * open a fence that runs to the end of the note.
 */
export function completeFence(
  state: EditorState,
  text: string,
): TransactionSpec | undefined {
  const { ranges, main } = state.selection;
  if (text !== "`" || ranges.length > 1 || !main.empty) {
    return undefined;
  }
  const line = state.doc.lineAt(main.head);
  const before = line.text.slice(0, main.head - line.from);
  const ticks = /`*$/u.exec(before)![0].length;
  if (ticks < 2 || !opensLine(before.slice(0, before.length - ticks))) {
    return undefined;
  }
  const close =
    ticks === 2 ? state.lineBreak + continuationPrefix(line.text) + "```" : "";
  return {
    changes: { from: main.head, insert: "`" + close },
    selection: EditorSelection.cursor(main.head + 1),
    userEvent: "input.type",
  };
}

/** Whether `prefix` is only a line's indentation, quotes and list marker. */
function opensLine(prefix: string): boolean {
  const { quotes, marker } = lineMarkup(prefix);
  return prefix.slice(quotes.length + marker.length).trim() === "";
}

/** Runs before CodeMirror's bracket closing, which would pair these. */
export const markdownInput: Extension = Prec.high(
  EditorView.inputHandler.of((view, from, to, text) => {
    const { state } = view;
    const main = state.selection.main;
    if (view.composing || from !== main.from || to !== main.to) {
      return false;
    }
    const spec = wrapOnly(state, text) ?? completeFence(state, text);
    if (!spec) {
      return false;
    }
    view.dispatch(spec);
    return true;
  }),
);
