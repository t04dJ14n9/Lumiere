import {
  EditorSelection,
  type EditorState,
  type Line,
  type TransactionSpec,
} from "@codemirror/state";
import { selectedLines } from "../../markdown/selected-lines";

/**
 * A line's quote markers and indentation, which stay as they are, then its
 * list marker: a bullet, a number, or a task.
 */
const LIST_ITEM = /^([>\s]*)((?:[-*+]|\d+[.)]) (?:\[.\] )?)?/u;

/** A line's quote markers and indentation, then its heading marker. */
const HEADING = /^([>\s]*)(#{1,6}[ \t]+)?/u;

type LineChange = { from: number; to?: number; insert?: string };

/**
 * The length of one level of quote at the start of `text`, or `undefined`
 * when it has none: up to three spaces, `>`, and a space after it unless
 * that space starts indented code (four spaces) inside the quote.
 */
function quoteLength(text: string): number | undefined {
  const match = /^(\s{0,3}>)(\s*)/u.exec(text);
  if (!match) {
    return undefined;
  }
  let after = match[2]!;
  while (after.startsWith("    ")) {
    after = after.slice(4);
  }
  return match[1]!.length + (after.startsWith(" ") ? 1 : 0);
}

/** Whether a line already is the kind of line `prefix` makes. */
function isKind(text: string, prefix: string): boolean {
  if (prefix === "> ") {
    return quoteLength(text) !== undefined;
  }
  const marker = LIST_ITEM.exec(text)![2] ?? "";
  // Obsidian's numeric guard sees through a task box; its bullet guard does
  // not, so the two prefixes deliberately differ.
  return prefix === "1. "
    ? /^\d+[.)] (?:\[.\] )?$/u.test(marker)
    : /^[-*+] $/u.test(marker);
}

/**
 * Headings, lists and quotes on the selected lines, as in Obsidian: a
 * heading replaces the line's heading; a list marker replaces another list's
 * (a task's checkbox goes too), or comes off when every line has it; a quote
 * marker goes on the lines without one, or one level comes off when every
 * line has one. Markers go after a line's quote markers and indentation, so
 * a quote or callout stays one. Blank lines in a selection of several are
 * left alone, except by the quote, which quotes them too (so a blank line
 * among quoted ones quotes it rather than unquoting the rest). A caret on an
 * empty line ends up after the marker. As in Obsidian, the lines of every
 * selection range count, and a range ending at the start of a line includes
 * that line (`selectedLines`).
 */
export function lineEdit(state: EditorState, prefix: string): TransactionSpec {
  const lines = selectedLines(state, { keepBlank: prefix === "> " });
  const all = lines.every((line) => isKind(line.text, prefix));
  const changes = state.changes(
    lines.map((line) => lineChange(line, prefix, { all })),
  );
  return {
    changes,
    selection: state.selection.map(changes, 1),
    userEvent: "input",
  };
}

function lineChange(
  line: Line,
  prefix: string,
  { all }: { all: boolean },
): LineChange {
  if (/^#{0,6} ?$/u.test(prefix)) {
    const [, lead = "", old = ""] = HEADING.exec(line.text)!;
    const from = line.from + lead.length;
    return { from, to: from + old.length, insert: prefix };
  }
  if (prefix === "> ") {
    const quote = quoteLength(line.text);
    if (all) {
      return { from: line.from, to: line.from + (quote ?? 0) };
    }
    return { from: line.from, insert: quote === undefined ? prefix : "" };
  }
  const [, lead = "", marker = ""] = LIST_ITEM.exec(line.text)!;
  const from = line.from + lead.length;
  // Obsidian writes the literal "1. " on every line and lets the renderer
  // number them; do not renumber the markers here.
  return { from, to: from + marker.length, insert: all ? "" : prefix };
}
/**
 * Insert Link, as in Obsidian: at every selection, the selected text becomes
 * the label and the caret goes into the empty URL; with no selection, into
 * the empty label.
 */
export function linkEdit(state: EditorState): TransactionSpec {
  return {
    ...state.changeByRange(({ from, to }) => {
      const label = state.sliceDoc(from, to);
      return {
        changes: { from, to, insert: `[${label}]()` },
        range: EditorSelection.cursor(
          label ? from + label.length + 3 : from + 1,
        ),
      };
    }),
    userEvent: "input",
  };
}

/**
 * Insert Horizontal Rule, as in Obsidian: at every selection, the rule
 * replaces it on a line of its own, after a blank line unless it starts its
 * line, and the caret goes to the start of the line after it.
 */
export function ruleEdit(state: EditorState): TransactionSpec {
  return {
    ...state.changeByRange(({ from, to }) => {
      const before = state.sliceDoc(state.doc.lineAt(from).from, from);
      const insert = `${before ? "\n\n" : "\n"}---\n`;
      return {
        changes: { from, to, insert },
        range: EditorSelection.cursor(from + insert.length),
      };
    }),
    userEvent: "input",
  };
}

/**
 * Fence lines around the lines of every selection, each staying on its text,
 * as Obsidian's Insert Code Block does, including the line a selection ends
 * at the start of.
 */
export function fenceLines(
  state: EditorState,
  open: string,
  close: string,
): TransactionSpec {
  const before = `${open}\n`;
  return {
    ...state.changeByRange(({ from, to, anchor, head }) => ({
      changes: [
        { from: state.doc.lineAt(from).from, insert: before },
        { from: state.doc.lineAt(to).to, insert: `\n${close}` },
      ],
      range: EditorSelection.range(
        anchor + before.length,
        head + before.length,
      ),
    })),
    userEvent: "input",
  };
}

/**
 * Insert Tag, as in Obsidian: `#` before the selection, the caret after it,
 * and the edit asks for suggestions, so the list of tags opens at once.
 */
export function tagEdit(state: EditorState): TransactionSpec {
  const { from } = state.selection.main;
  return {
    changes: { from, insert: "#" },
    selection: { anchor: from + 1 },
    userEvent: "input.autocomplete",
  };
}
