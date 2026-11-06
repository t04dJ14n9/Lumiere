/**
 * Resolve a Chrome Text Fragment to glyph line rects on a page.
 * Soft-fails (undefined) when the text is missing or has no drawable glyphs.
 *
 * Matching follows Chrome's: case and whitespace differences are ignored.
 * That matters because a link's quote was joined with single spaces when it
 * was copied, while the page text has the "\r\n" PDFium puts between lines.
 */
import { findQuoteAtPageEdge } from "./pdf-backlink-page-edge";
import { foldText, rawRangeOf, type TextRange } from "./page-text-fold";
import type { SegmentRect } from "./sidecar-format";
import { lineRects, type GlyphBox } from "./sidecar-reattach";

/** What a link's `#:~:text=` names: `[prefix-,]textStart[,textEnd][,-suffix]`. */
export interface TextFragmentQuery {
  textStart: string;
  /** With `textStart`, the passage runs from its start to the end of this. */
  textEnd?: string;
  /** Text that must come right before the passage; not part of it. */
  prefix?: string;
  /** Text that must come right after the passage; not part of it. */
  suffix?: string;
}

/**
 * Where the fragment is in the raw page text: the first place that satisfies
 * `textStart` (to `textEnd`, when given) with its prefix and suffix around it.
 */
export function findTextFragment(
  pageText: string,
  query: TextFragmentQuery | string,
): TextRange | undefined {
  const folded = foldQuery(
    typeof query === "string" ? { textStart: query } : query,
  );
  if (!folded) {
    return undefined;
  }
  const page = foldText(pageText);
  const found = findFolded(page.text, folded);
  return found && rawRangeOf(page, found.start, found.end);
}

/**
 * Line rects over the glyphs of the first match; glyph boxes are parallel to
 * the characters of `pageText` (`undefined` for spaces / empty glyphs). When
 * the whole quote is not on the page, the part of it that is at the page's
 * edge is painted: a quote that crosses a page break is in the links of both
 * pages. No match or no drawable glyphs → undefined (skip overlay paint).
 */
export function resolveTextToLineRects(
  pageText: string,
  glyphBoxes: readonly (GlyphBox | undefined)[],
  query: TextFragmentQuery | string,
): SegmentRect[] | undefined {
  const range =
    findTextFragment(pageText, query) ?? findQuotePartOnPage(pageText, query);
  if (!range) {
    return undefined;
  }
  const boxes = glyphBoxes
    .slice(range.start, range.end)
    .filter((box): box is GlyphBox => box !== undefined);
  if (boxes.length === 0) {
    return undefined;
  }
  const rects = lineRects(boxes);
  return rects.length > 0 ? rects : undefined;
}

/**
 * The part of a quote that crosses a page break which is on this page. Only
 * a plain quote can be cut: with a `textEnd` the link names the passage's two
 * ends, not its text, and prefix and suffix cannot be checked across pages.
 */
function findQuotePartOnPage(
  pageText: string,
  query: TextFragmentQuery | string,
): TextRange | undefined {
  const { textStart, textEnd } =
    typeof query === "string"
      ? { textStart: query, textEnd: undefined }
      : query;
  return textEnd ? undefined : findQuoteAtPageEdge(pageText, textStart);
}

/** The query folded like page text; undefined when `textStart` is blank. */
function foldQuery(query: TextFragmentQuery): TextFragmentQuery | undefined {
  const textStart = foldText(query.textStart).text;
  if (!textStart) {
    return undefined;
  }
  const folded: TextFragmentQuery = { textStart };
  for (const key of ["textEnd", "prefix", "suffix"] as const) {
    const part = foldText(query[key] ?? "").text;
    if (part) {
      folded[key] = part;
    }
  }
  return folded;
}

function findFolded(
  text: string,
  query: TextFragmentQuery,
): TextRange | undefined {
  const { textStart } = query;
  // Step by one so overlapping candidates are tried: the first may lack the
  // prefix or suffix the second has.
  for (
    let at = text.indexOf(textStart);
    at >= 0;
    at = text.indexOf(textStart, at + 1)
  ) {
    if (!followsPrefix(text, at, query.prefix)) {
      continue;
    }
    const end = findEnd(text, at + textStart.length, query);
    if (end !== undefined) {
      return { start: at, end };
    }
  }
  return undefined;
}

/** Where the passage that starts before `from` ends, if it can. */
function findEnd(
  text: string,
  from: number,
  { textEnd, suffix }: TextFragmentQuery,
): number | undefined {
  if (!textEnd) {
    return precedesSuffix(text, from, suffix) ? from : undefined;
  }
  for (
    let at = text.indexOf(textEnd, from);
    at >= 0;
    at = text.indexOf(textEnd, at + 1)
  ) {
    const end = at + textEnd.length;
    if (precedesSuffix(text, end, suffix)) {
      return end;
    }
  }
  return undefined;
}

// Folded text has at most one space between words, so context is adjacent
// when it is directly there or one space away.
function followsPrefix(
  text: string,
  start: number,
  prefix: string | undefined,
): boolean {
  if (!prefix) {
    return true;
  }
  const end = text[start - 1] === " " ? start - 1 : start;
  return end >= prefix.length && text.startsWith(prefix, end - prefix.length);
}

function precedesSuffix(
  text: string,
  end: number,
  suffix: string | undefined,
): boolean {
  if (!suffix) {
    return true;
  }
  return text.startsWith(suffix, text[end] === " " ? end + 1 : end);
}
