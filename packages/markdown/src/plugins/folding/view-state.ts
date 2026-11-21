import { foldEffect, foldedRanges, unfoldEffect } from "@codemirror/language";
import {
  Annotation,
  type StateEffect,
  type Text,
  type Transaction,
} from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { EDGE_LENGTH, savedFolds, type SavedFold } from "./protocol";

/** Marks the transaction that puts saved folds back: not the reader's fold. */
const restoredFolds = Annotation.define<boolean>();

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

/**
 * Whether a transaction folds or unfolds something itself (a command, the
 * gutter, a reveal), rather than putting saved folds back.
 */
export function changesFolds(transaction: Transaction): boolean {
  return (
    !transaction.annotation(restoredFolds) &&
    transaction.effects.some(
      (effect) => effect.is(foldEffect) || effect.is(unfoldEffect),
    )
  );
}

export const foldedViewState = {
  schema: savedFolds,
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
    view.dispatch({ effects, annotations: restoredFolds.of(true) });
  },
};
