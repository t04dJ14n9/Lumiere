import { StateField, type Text } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { parseMarkdown } from "../../markdown/dialect";
import {
  headingsIn,
  type Heading,
} from "../../markdown/metadata/heading-extract";
import { documentTree, editTouches, isPlainTextEdit } from "../livePreview/api";

/** Container-local headings in quotes and lists do not define note sections. */
export function sectionHeadings(doc: Text, syntax?: Tree): readonly Heading[] {
  const tree = syntax ?? parseMarkdown(doc);
  return headingsIn(tree, (from, to) => doc.sliceString(from, to)).map(
    (heading) => {
      // The shared label extractor retains bare ATX marks for an empty heading.
      const source = doc.sliceString(heading.from, heading.to);
      return /^#{1,6}(?:\s+#+)?\s*$/.test(source)
        ? { ...heading, label: "" }
        : heading;
    },
  );
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
      const { changes } = transaction;
      return headings.map((heading) => ({
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
      }));
    }
    if (
      transaction.docChanged ||
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
