import type { EditorState, Line } from "@codemirror/state";

/**
 * The lines Obsidian's line commands edit (`processLines`): every line from
 * each selection range's first to its last, whichever way the range runs and
 * including the line it ends at the start of, in order and each once. Blank
 * lines are left out of a set of several unless `keepBlank`.
 */
export function selectedLines(
  state: EditorState,
  { keepBlank = false }: { keepBlank?: boolean } = {},
): Line[] {
  const numbers = new Set<number>();
  for (const range of state.selection.ranges) {
    const last = state.doc.lineAt(range.to).number;
    for (let n = state.doc.lineAt(range.from).number; n <= last; n++) {
      numbers.add(n);
    }
  }
  const lines = [...numbers]
    .sort((left, right) => left - right)
    .map((n) => state.doc.line(n));
  return lines.length > 1 && !keepBlank
    ? lines.filter((line) => line.text.trim())
    : lines;
}
