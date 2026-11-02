import type { Transaction } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { markdownTree, replaceDocumentTree } from "./api";

/**
 * Characters an edit may not add or remove and still be plain: a line
 * break, and the marks that make or unmake Markdown blocks or hide them
 * (headings, setext underlines, list and table marks, code fences, math,
 * comments, HTML, escapes).
 */
const STRUCTURAL = /[\n#=\-`~$%\\<>|+*]/;

/** A line's leading block marks: quote, list item, task box, heading. */
const LEADING =
  /^[ \t]*(?:>[ \t]?|[-+*](?:[ \t]+(?:\[.\][ \t]+)?|$)|\d{1,9}[.)](?:[ \t]+(?:\[.\][ \t]+)?|$)|#{1,6}(?:[ \t]+|$))*/;
/**
 * Lines that are marks alone, where any character counts: code fences,
 * setext underlines, thematic breaks (`___`), table delimiter rows, `$$`
 * and `%%` lines.
 */
const MARKS_ONLY = /^[\s\-=*_`~:|+#>.$%]*$/;
/**
 * Fences, and footnote and link definitions (`[^a]: …`, `[a]: …`), which a
 * word in their label can turn into a paragraph.
 */
const FENCE = /^[ \t]*(?:`{3,}|~{3,}|\[)/;

function sameKind(before: string, after: string): boolean {
  const marks = LEADING.exec(before)![0];
  return (
    marks === LEADING.exec(after)![0] &&
    // An empty list item (`1. `) cannot interrupt a paragraph; a full one can.
    [before, after].every(
      (text) =>
        /\S/.test(text.slice(marks.length)) &&
        !MARKS_ONLY.test(text) &&
        !FENCE.test(text),
    )
  );
}

/**
 * Whether every change in `transaction` is plain text typed or deleted
 * after other text on its line, leaving the line's leading marks as they
 * were, such as a word typed in a paragraph or a list item: an
 * edit that can change no block of the note (no heading, list item, code
 * block or quote starts, ends or moves to another line). Indexes of the
 * note's blocks can then map their positions through the changes instead
 * of walking the whole note again on every keystroke.
 */
export function isPlainTextEdit(transaction: Transaction): boolean {
  // Asked by several indexes about the same transaction.
  let plain = verdicts.get(transaction);
  if (plain === undefined) {
    plain = plainTextEdit(transaction);
    verdicts.set(transaction, plain);
  }
  return plain;
}

const verdicts = new WeakMap<Transaction, boolean>();

function plainTextEdit(transaction: Transaction): boolean {
  if (
    !transaction.docChanged ||
    transaction.effects.some((effect) => effect.is(replaceDocumentTree))
  ) {
    return false;
  }
  const doc = transaction.startState.doc;
  const next = transaction.newDoc;
  let plain = true;
  transaction.changes.iterChanges((...change) => {
    const [fromA, toA, , , inserted] = change;
    if (!plain) {
      return;
    }
    const line = doc.lineAt(fromA);
    plain =
      toA <= line.to &&
      /\S/.test(line.text.slice(0, fromA - line.from)) &&
      !STRUCTURAL.test(doc.sliceString(fromA, toA)) &&
      !STRUCTURAL.test(inserted.toString()) &&
      // No line break went in or out, so the line keeps its number. The
      // marks a word can still make or break: `-word` made `- word`.
      sameKind(line.text, next.line(line.number).text);
  });
  return plain && sameBlocksAround(transaction);
}

/**
 * The parser's word on it: around every change, the same blocks (document,
 * quote, list, item, paragraph, fence…) with the same extents, moved by the
 * edit, in the tree after it as in the tree before. The text checks above
 * miss some cases (a fence inside a quote); this one does not guess.
 */
function sameBlocksAround(transaction: Transaction): boolean {
  const before = markdownTree(transaction.startState);
  const after = markdownTree(transaction.state);
  const { changes } = transaction;
  let same = true;
  changes.iterChanges((fromA, _toA, fromB) => {
    if (!same) {
      return;
    }
    // The character before the change is text on the same line.
    const old = blockPath(before, fromA);
    const now = blockPath(after, fromB);
    same =
      old.length === now.length &&
      old.every(
        (block, index) =>
          block.name === now[index]!.name &&
          changes.mapPos(block.from, -1) === now[index]!.from &&
          changes.mapPos(block.to, 1) === now[index]!.to,
      );
  });
  return same;
}

function blockPath(
  tree: Tree,
  position: number,
): { name: string; from: number; to: number }[] {
  const path: { name: string; from: number; to: number }[] = [];
  for (
    let node: ReturnType<Tree["resolveInner"]> | null = tree.resolveInner(
      position,
      -1,
    );
    node;
    node = node.parent
  ) {
    if (node.type.is("Block")) {
      path.push({ name: node.name, from: node.from, to: node.to });
    }
  }
  return path;
}

/** Whether a change in `transaction` touches `from`–`to` (ends included). */
export function editTouches(
  transaction: Transaction,
  from: number,
  to: number,
): boolean {
  let touches = false;
  transaction.changes.iterChangedRanges((fromA, toA) => {
    touches ||= fromA <= to && toA >= from;
  });
  return touches;
}
