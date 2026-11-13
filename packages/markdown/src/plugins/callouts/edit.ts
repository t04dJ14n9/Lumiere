import type { EditorState, TransactionSpec } from "@codemirror/state";
/**
 * Whether a quote opens with a callout's `[!type]`, as Obsidian reads it: any
 * type but `]` (`[!note|wide]`, `[!笔记]`), then a space or the line's end.
 */
export function isCallout(source: string): boolean {
  return /^\s*>\s*\[![^\]\n]+\][+-]?(?:\s|$)/.test(source);
}
/**
 * Insert Callout, as in Obsidian: with the caret at column 0 of a non-empty
 * line, insert `\n> [!NOTE] Title\n> Contents\n` above that line; on an empty
 * line, insert a callout with a title and contents to replace; otherwise wrap
 * the selected lines in a note callout with a blank line between it and any
 * text above or below. The callout's type is selected. A selection ending at
 * column zero does not include that line.
 */
export function insertCallout(state: EditorState): TransactionSpec {
  const { from, to, empty } = state.selection.main;
  const first = state.doc.lineAt(from);

  // Obsidian 1.15.0's collapsed-caret branch inserts the Title/Contents
  // template at the caret. Its leading newline leaves the line below it.
  if (empty && from === first.from && first.text.trim() !== "") {
    return insertTemplateAbove(first.from);
  }

  const last = state.doc.lineAt(empty ? to : Math.max(from, to - 1));
  const text = state.sliceDoc(first.from, last.to);
  const touches = (n: number) =>
    n >= 1 && n <= state.doc.lines && state.doc.line(n).text.trim() !== "";
  const [before, body, after] = text.trim()
    ? [
        touches(first.number - 1) ? "\n" : "",
        `> [!NOTE]\n${text
          .split("\n")
          .map((line) => `> ${line}`)
          .join("\n")}`,
        touches(last.number + 1) ? "\n" : "",
      ]
    : ["\n", "> [!NOTE] Title\n> Contents", "\n"];
  const type = first.from + before.length + "> [!".length;
  return {
    changes: { from: first.from, to: last.to, insert: before + body + after },
    selection: { anchor: type, head: type + "NOTE".length },
    userEvent: "input.callout",
  };
}

/** Insert Obsidian's Title/Contents template above a line, leaving the line. */
function insertTemplateAbove(lineFrom: number): TransactionSpec {
  const template = "\n> [!NOTE] Title\n> Contents\n";
  const type = lineFrom + "\n> [!".length;
  return {
    changes: { from: lineFrom, to: lineFrom, insert: template },
    selection: { anchor: type, head: type + "NOTE".length },
    userEvent: "input.callout",
  };
}
