import { foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import type { StateEffect, Text } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { Schema } from "@workshop/core";

/** Enough of a line to tell it from its neighbours, and no more to save. */
const EDGE_LENGTH = 120;

interface SavedFold {
  from: number;
  to: number;
  /**
   * The text of the lines the fold starts and ends on (their first
   * `EDGE_LENGTH` characters). Saved offsets are only good for the text
   * they were taken from: a note changed outside this panel would fold
   * other lines. Absent in view state saved before it was recorded.
   */
  edges?: string[];
}

const foldedSchema = Schema.array(
  new Schema<SavedFold>(
    (value) => {
      const range = Schema.object({
        from: Schema.number(),
        to: Schema.number(),
        edges: Schema.array(Schema.string()).optional(),
      }).parse(value);
      if (
        !Number.isSafeInteger(range.from) ||
        !Number.isSafeInteger(range.to) ||
        range.from < 0 ||
        range.from >= range.to ||
        (range.edges && range.edges.length !== 2)
      ) {
        throw new Error("Invalid fold range");
      }
      return range;
    },
    { type: "object" },
  ),
);

function foldEdges(doc: Text, from: number, to: number): string[] {
  return [from, to].map((at) => doc.lineAt(at).text.slice(0, EDGE_LENGTH));
}

/** Whether a saved fold still covers the text it was taken from. */
function stillFits(doc: Text, fold: SavedFold): boolean {
  if (fold.to > doc.length) {
    return false;
  }
  const { edges } = fold;
  if (!edges) {
    return true;
  }
  const [start, end] = foldEdges(doc, fold.from, fold.to);
  return start === edges[0] && end === edges[1];
}

export const foldedViewState = {
  schema: foldedSchema,
  capture(view: EditorView): SavedFold[] {
    const { doc } = view.state;
    const ranges: SavedFold[] = [];
    foldedRanges(view.state).between(0, doc.length, (from, to) => {
      ranges.push({ from, to, edges: foldEdges(doc, from, to) });
    });
    return ranges;
  },
  restore(view: EditorView, ranges: SavedFold[]) {
    const effects: StateEffect<unknown>[] = [];
    foldedRanges(view.state).between(0, view.state.doc.length, (from, to) => {
      effects.push(unfoldEffect.of({ from, to }));
    });
    // @codemirror/language >= 6.13 requires fold effects sorted by position.
    const sorted = [...ranges].sort((a, b) => a.from - b.from || b.to - a.to);
    for (const range of sorted) {
      if (stillFits(view.state.doc, range)) {
        effects.push(foldEffect.of({ from: range.from, to: range.to }));
      }
    }
    view.dispatch({ effects });
  },
};
