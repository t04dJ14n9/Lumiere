import {
  charRangeForTextOffsets,
  type PageTextSnapshot,
  type TextLayout,
} from "@embedpdf/engine";
import type { SegmentRect } from "../shared/line-rects";
import { findQuoteAtPageEdge } from "../shared/pdf-backlink-page-edge";
import {
  findTextFragment,
  type TextFragmentQuery,
} from "../shared/pdf-backlink-resolve";

/**
 * One box per line of the page text a `#:~:text=` fragment names, in points
 * from the page's top-left; undefined when the quote is not on the page or
 * has nothing drawable.
 *
 * The fragment is matched against the page's string, which has dropped the
 * markers PDFium keeps for a hyphen at a line end, so the string range is
 * turned back into characters (`charRangeForTextOffsets`) before the layout
 * draws it: the two numberings differ by exactly those characters.
 *
 * When the whole quote is not on the page, the part of it at the page's edge
 * is painted: a quote that crosses a page break is in the links of both
 * pages. Only a plain quote can be cut: with a `textEnd` the link names the
 * passage's two ends, not its text.
 */
export function backlinkRects(
  page: PageTextSnapshot,
  layout: Pick<TextLayout, "segments">,
  query: TextFragmentQuery,
): SegmentRect[] | undefined {
  const range =
    findTextFragment(page.text, query) ??
    (query.textEnd
      ? undefined
      : findQuoteAtPageEdge(page.text, query.textStart));
  if (!range) {
    return undefined;
  }
  const characters = charRangeForTextOffsets(page, {
    start: range.start,
    count: range.end - range.start,
  });
  const rects = layout.segments(characters).map(({ rect }) => ({
    x: rect.x,
    y: rect.y,
    w: rect.width,
    h: rect.height,
  }));
  return rects.length > 0 ? rects : undefined;
}
