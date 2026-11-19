import { StateField, type Text, type Transaction } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { parseMarkdown } from "../../markdown/dialect";
import {
  headingsIn,
  numberHeadings,
  type Heading,
} from "../../markdown/metadata/heading-extract";
import {
  changedBlocks,
  documentTree,
  editTouches,
  isPlainTextEdit,
} from "../livePreview/api";

/**
 * The note's own headings (not those in quotes and lists, which define no
 * section), all of them or those of the top-level blocks touching `range`.
 */
function readSectionHeadings(
  doc: Text,
  tree: Tree,
  range?: { from: number; to: number },
): Heading[] {
  return headingsIn(tree, (from, to) => doc.sliceString(from, to), range).map(
    (heading) => {
      // The shared label extractor retains bare ATX marks for an empty heading.
      const source = doc.sliceString(heading.from, heading.to);
      return /^#{1,6}(?:\s+#+)?\s*$/.test(source)
        ? { ...heading, label: "" }
        : heading;
    },
  );
}

/** Container-local headings in quotes and lists do not define note sections. */
export function sectionHeadings(doc: Text, syntax?: Tree): readonly Heading[] {
  const tree = syntax ?? parseMarkdown(doc);
  return numberHeadings(readSectionHeadings(doc, tree), tree.topNode);
}

/** Ancestors of the first visible block, excluding a heading still on screen. */
export function stickyHeadings(
  headings: readonly Heading[],
  position: number,
  maxLines: number,
): readonly Heading[] {
  const ancestors = headings.filter(
    (heading) => heading.to < position && position <= heading.end,
  );
  const limit = Math.max(0, Math.floor(maxLines));
  return limit === 0 ? [] : ancestors.slice(-limit);
}

function mapHeading(heading: Heading, transaction: Transaction): Heading {
  const { changes } = transaction;
  return {
    ...heading,
    from: changes.mapPos(heading.from, 1),
    to: changes.mapPos(heading.to, -1),
    end: changes.mapPos(heading.end, 1),
    // The span of the heading's parent (the note), `from:to`.
    scope: heading.scope.replace(
      /^(\d+):(\d+)$/,
      (_all, from: string, to: string) =>
        `${changes.mapPos(Number(from), -1)}:${changes.mapPos(Number(to), 1)}`,
    ),
  };
}

/**
 * After an edit that may have made or unmade headings (Enter, a `#`, a
 * fence), only the top-level blocks Live Preview found changed are read
 * again; the headings before and after them are the old ones, moved.
 */
function rereadChangedBlocks(
  headings: readonly Heading[],
  transaction: Transaction,
): readonly Heading[] {
  const tree = transaction.state.field(documentTree, false);
  const region = changedBlocks(transaction);
  if (!tree || !region) {
    return sectionHeadings(transaction.newDoc, tree);
  }
  const { changes } = transaction;
  // Keys, sections and scope are worked out again below.
  const moved = headings.map((heading) => ({
    ...heading,
    from: changes.mapPos(heading.from, 1),
    to: changes.mapPos(heading.to, -1),
  }));
  return numberHeadings(
    [
      ...moved.filter((heading) => heading.to < region.from),
      ...readSectionHeadings(transaction.newDoc, tree, region),
      ...moved.filter((heading) => heading.from > region.to),
    ],
    tree.topNode,
  );
}

export const headingIndex = StateField.define<readonly Heading[]>({
  create: (state) =>
    sectionHeadings(state.doc, state.field(documentTree, false)),
  update(headings, transaction) {
    if (
      isPlainTextEdit(transaction) &&
      !headings.some((heading) =>
        editTouches(transaction, heading.from, heading.to),
      )
    ) {
      // A word typed outside every heading: the same headings, moved.
      return headings.map((heading) => mapHeading(heading, transaction));
    }
    if (transaction.docChanged) {
      return rereadChangedBlocks(headings, transaction);
    }
    if (
      transaction.startState.field(documentTree, false) !==
      transaction.state.field(documentTree, false)
    ) {
      return sectionHeadings(
        transaction.newDoc,
        transaction.state.field(documentTree, false),
      );
    }
    return headings;
  },
});
