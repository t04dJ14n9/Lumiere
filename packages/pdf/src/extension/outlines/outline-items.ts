import type { OutlineItem, PageLayout } from "@embedpdf/engine";
import {
  MAX_OUTLINE_SECTIONS,
  type OutlineSection,
} from "../../shared/outline-sections";
import { targetPage } from "../../shared/pdf-link-target";

const MAX_TITLE_LENGTH = 512;

/**
 * The bookmarks that open a page of the PDF, flattened in document order.
 * A bookmark that only groups others, or points outside the PDF, or has no
 * title is left out; its children are kept. Titles are one line.
 *
 * `items` is what `doc.outline.get()` returns: every item, parents before
 * their children, with no depth of its own. A depth is its parent's plus
 * one, which is why the parent must already be in `depths`.
 * @param pages The document's pages, as `doc.pages.list()` returns them.
 */
export function sectionsOfOutline(
  items: readonly OutlineItem[],
  pages: readonly Pick<PageLayout, "index" | "ref">[],
  limit = MAX_OUTLINE_SECTIONS,
): OutlineSection[] {
  const pageNumbers = new Map(
    pages.map((page) => [page.ref.objectNumber, page.index + 1]),
  );
  const depths = new Map<number, number>();
  const sections: OutlineSection[] = [];
  for (const item of items) {
    if (sections.length >= limit) {
      break;
    }
    const depth = item.parent
      ? (depths.get(item.parent.objectNumber) ?? 0) + 1
      : 0;
    depths.set(item.ref.objectNumber, depth);
    const page = targetPage(item.target, (ref) =>
      pageNumbers.get(ref.objectNumber),
    );
    const title = item.title
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, MAX_TITLE_LENGTH);
    if (page === undefined || !title) {
      continue;
    }
    sections.push({ title, page, depth });
  }
  return sections;
}
