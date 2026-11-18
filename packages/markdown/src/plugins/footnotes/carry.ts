import { StateField, type Transaction } from "@codemirror/state";
import {
  carryFootnotes,
  knownFootnotes,
  type Footnotes,
} from "../../markdown/metadata/footnote-extract";
import { editTouches, isPlainTextEdit } from "../livePreview/api";

/**
 * Moves the footnotes Live Preview already numbered to the next document
 * version when an edit cannot have changed them (a word typed outside every
 * footnote), so typing in a long note does not extract them all again.
 */
export const footnoteCarry = StateField.define<null>({
  create: () => null,
  update(value, transaction) {
    const known = knownFootnotes(transaction.startState.doc);
    if (known && untouchedFootnotes(transaction, known)) {
      carryFootnotes(transaction.startState.doc, transaction.newDoc, (at) =>
        transaction.changes.mapPos(at),
      );
    }
    return value;
  },
});

function untouchedFootnotes(
  transaction: Transaction,
  known: Footnotes,
): boolean {
  if (!isPlainTextEdit(transaction)) {
    return false;
  }
  const before = transaction.startState.doc;
  const after = transaction.newDoc;
  let marks = false;
  transaction.changes.iterChanges((...change) => {
    const [fromA, toA, , , inserted] = change;
    // On a line with footnote syntax, any word can make or unmake one: a
    // space in `[^label]` ends the reference, and `^[` before it becomes an
    // inline footnote. (A plain edit keeps line numbers.)
    const line = before.lineAt(fromA);
    marks ||=
      /[[\]^]/.test(before.sliceString(fromA, toA) + inserted.toString()) ||
      /\[\^|\^\[/.test(line.text + "\n" + after.line(line.number).text);
  });
  if (marks) {
    return false;
  }
  for (const note of known.definitions) {
    if (editTouches(transaction, note.from, note.to)) {
      return false;
    }
  }
  for (const [at, note] of known.references) {
    const end = note.label ? at + note.label.length + 3 : note.to;
    if (editTouches(transaction, at, end)) {
      return false;
    }
  }
  return true;
}
