import {
  RangeSet,
  StateField,
  type EditorState,
  type Range,
  type Transaction,
} from "@codemirror/state";
import { GutterMarker, gutterLineClass } from "@codemirror/view";
import {
  changedBlocks,
  isPlainTextEdit,
  markdownTree,
} from "../livePreview/api";

/**
 * Marks the gutter cells of heading, code and list item lines, so line
 * numbers align with their larger or smaller text and their padding.
 */
class HeadingLine extends GutterMarker {
  override elementClass: string;
  constructor(
    readonly level: number,
    readonly isFirstLine: boolean,
  ) {
    super();
    // Line 1 has no padding above its heading (livePreview/inline.ts).
    this.elementClass = `md-h${level}-gutter${isFirstLine ? " is-first-line" : ""}`;
  }
  override eq(other: GutterMarker): boolean {
    return (
      other instanceof HeadingLine &&
      other.level === this.level &&
      other.isFirstLine === this.isFirstLine
    );
  }
}
const levels = [1, 2, 3, 4, 5, 6];
const markers = levels.map((level) => new HeadingLine(level, false));
const firstLineMarkers = levels.map((level) => new HeadingLine(level, true));

class CodeLine extends GutterMarker {
  override elementClass = "md-code-gutter";
  override eq(other: GutterMarker): boolean {
    return other instanceof CodeLine;
  }
}
const codeLine = new CodeLine();

class ListLine extends GutterMarker {
  override elementClass = "md-list-gutter";
  override eq(other: GutterMarker): boolean {
    return other instanceof ListLine;
  }
}
const listLine = new ListLine();
// Headings are blocks; these are the only nodes that can contain one.
const containers = new Set([
  "Document",
  "Blockquote",
  "BulletList",
  "OrderedList",
  "ListItem",
]);

/** The marked lines of the note, or of the lines starting in `range`. */
export function headingLines(
  state: EditorState,
  range?: { from: number; to: number },
): RangeSet<GutterMarker> {
  return RangeSet.of(markedLines(state, range), true);
}

function markedLines(
  state: EditorState,
  range?: { from: number; to: number },
): Range<GutterMarker>[] {
  const ranges: Range<GutterMarker>[] = [];
  markdownTree(state).iterate({
    ...range,
    enter(node) {
      const level = /^(?:ATXHeading|SetextHeading)(\d)$/.exec(node.name)?.[1];
      if (level) {
        const from = state.doc.lineAt(node.from).from;
        const marker = (from === 0 ? firstLineMarkers : markers)[
          Number(level) - 1
        ]!;
        ranges.push(marker.range(from));
        return false;
      }
      if (node.name === "ListItem") {
        // As Live Preview pads them: an item's first line, outside quotes.
        const line = state.doc.lineAt(node.from);
        if (!/\S/u.test(state.sliceDoc(line.from, node.from))) {
          ranges.push(listLine.range(line.from));
        }
      }
      if (node.name === "FencedCode") {
        const last = state.doc.lineAt(node.to).number;
        for (let n = state.doc.lineAt(node.from).number; n <= last; n++) {
          ranges.push(codeLine.range(state.doc.line(n).from));
        }
        return false;
      }
      return containers.has(node.name);
    },
  });
  // The walk also enters blocks that only touch the range.
  return range
    ? ranges.filter(
        (marker) => marker.from >= range.from && marker.from <= range.to,
      )
    : ranges;
}

/**
 * After an edit that may have made or unmade marked lines (Enter, a `#`, a
 * fence), only the lines of the top-level blocks Live Preview found changed
 * are marked again; the others keep their markers, moved.
 */
function remarkChangedBlocks(
  value: RangeSet<GutterMarker>,
  transaction: Transaction,
): RangeSet<GutterMarker> {
  const region = changedBlocks(transaction);
  if (!region) {
    return headingLines(transaction.state);
  }
  return value.map(transaction.changes).update({
    filterFrom: region.from,
    filterTo: region.to,
    filter: (from) => from < region.from || from > region.to,
    add: markedLines(transaction.state, region),
    sort: true,
  });
}

export const headingGutterClasses = StateField.define<RangeSet<GutterMarker>>({
  create: headingLines,
  update(value, transaction) {
    if (isPlainTextEdit(transaction)) {
      // No line became or stopped being a heading, list item or code line.
      return value.map(transaction.changes);
    }
    if (
      markdownTree(transaction.state) === markdownTree(transaction.startState)
    ) {
      return value;
    }
    return transaction.docChanged
      ? remarkChangedBlocks(value, transaction)
      : headingLines(transaction.state);
  },
  provide: (field) => gutterLineClass.from(field),
});
