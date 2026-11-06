import type { PdfBookmarkObject } from "@embedpdf/models";
import { targetPage } from "./pdf-link-target";

/** One bookmark that opens a page of the PDF itself. */
export interface OutlineSection {
  title: string;
  /** 1-based. */
  page: number;
  /** 0 for a top-level bookmark. */
  depth: number;
}

/** A PDF with more bookmarks than this is cut off, as a suggestion list could not use them. */
export const MAX_OUTLINE_SECTIONS = 5000;

const MAX_TITLE_LENGTH = 512;

/**
 * The bookmarks that open a page of the PDF, flattened in document order.
 * A bookmark that only groups others, or points outside the PDF, or has no
 * title is left out; its children are kept. Titles are one line.
 */
export function outlineSections(
  bookmarks: readonly PdfBookmarkObject[],
  limit = MAX_OUTLINE_SECTIONS,
): OutlineSection[] {
  const sections: OutlineSection[] = [];
  const visit = (nodes: readonly PdfBookmarkObject[], depth: number): void => {
    for (const bookmark of nodes) {
      if (sections.length >= limit) {
        return;
      }
      const page = targetPage(bookmark.target);
      const title = bookmark.title
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, MAX_TITLE_LENGTH);
      if (page !== undefined && title) {
        sections.push({ title, page, depth });
      }
      visit(bookmark.children ?? [], depth + 1);
    }
  };
  visit(bookmarks, 0);
  return sections;
}
