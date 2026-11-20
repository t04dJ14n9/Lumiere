import type { ChangeSet, Text } from "@codemirror/state";

const MARKER = "[^";

/**
 * Whether a note may hold footnotes: whether `[^` appears in it. A note
 * without one gains one only where an edit put text, or joined text by
 * deleting some, so after the first look only the changed lines are read,
 * instead of the whole note on every keystroke.
 */
export function gainedFootnoteMarker(changes: ChangeSet, doc: Text): boolean {
  let gained = false;
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
    // One character either side: a deletion can join `[` and `^`.
    gained ||= doc
      .sliceString(Math.max(0, fromB - 1), Math.min(doc.length, toB + 1))
      .includes(MARKER);
  });
  return gained;
}

/** Whether `[^` appears anywhere in `doc`, read a line at a time. */
export function hasFootnoteMarker(doc: Text): boolean {
  for (const iter = doc.iterLines(); !iter.next().done;) {
    if (iter.value.includes(MARKER)) {
      return true;
    }
  }
  return false;
}
