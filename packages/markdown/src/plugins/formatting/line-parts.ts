import { syntaxTree } from "@codemirror/language";
import type { EditorState, Line } from "@codemirror/state";
import { textStart } from "../../markdown/list-markup";

/** A stretch of one line that an inline format wraps. */
export interface LinePart {
  from: number;
  to: number;
}

/** Blocks whose lines an inline format leaves alone when a selection runs past them. */
const UNFORMATTED_BLOCKS = new Set([
  "Table",
  "FencedCode",
  "CodeBlock",
  "MathBlock",
]);

/** A heading's `#` run, after the line's quotes and list markup. */
const HEADING_MARKER = /^#{1,6}(?=[ \t]|$)/u;

/**
 * The parts of `from`–`to` an inline format wraps, as Obsidian 1.15 picks
 * them: on each line, its text after the quote, list, task and heading
 * markers, without the spaces at either end of that text or of the
 * selection. A table, code block or math block line is skipped when the
 * selection runs past it. Lines left with nothing are left out.
 */
export function formattableParts(
  state: EditorState,
  from: number,
  to: number,
): LinePart[] {
  const selected = withoutEdgeSpaces(state, { from, to });
  const parts: LinePart[] = [];
  const last = state.doc.lineAt(to).number;
  for (let n = state.doc.lineAt(from).number; n <= last; n++) {
    const line = state.doc.line(n);
    const runsPast = from < line.from || to > line.to;
    if (runsPast && isUnformattedLine(state, line)) {
      continue;
    }
    const text = lineText(state, line);
    const part = {
      from: Math.min(Math.max(text.from, selected.from), selected.to),
      to: Math.min(Math.max(text.to, selected.from), selected.to),
    };
    if (part.to > part.from) {
      parts.push(part);
    }
  }
  return parts;
}

/** A line's text after its markers, without spaces at either end. */
function lineText(state: EditorState, line: Line): LinePart {
  const markup = textStart(line.text);
  const heading = HEADING_MARKER.exec(line.text.slice(markup))?.[0] ?? "";
  return withoutEdgeSpaces(state, {
    from: line.from + markup + heading.length,
    to: line.to,
  });
}

function withoutEdgeSpaces(state: EditorState, part: LinePart): LinePart {
  let { from, to } = part;
  while (from < to && /\s/u.test(state.sliceDoc(from, from + 1))) {
    from++;
  }
  while (to > from && /\s/u.test(state.sliceDoc(to - 1, to))) {
    to--;
  }
  return { from, to };
}

function isUnformattedLine(state: EditorState, line: Line): boolean {
  let found = false;
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter(node) {
      if (found) {
        return false;
      }
      if (UNFORMATTED_BLOCKS.has(node.name)) {
        found = true;
        return false;
      }
      return undefined;
    },
  });
  return found;
}
