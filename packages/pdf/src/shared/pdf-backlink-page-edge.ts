/**
 * A quote that crosses a page break. Copy link writes the whole quote into
 * the link of each page the selection touches (agent-text.ts), so a page
 * only holds one end of it and a search for the whole quote fails on both.
 * What is left to paint is the part of the quote that is on this page, which
 * can only be at an edge of it: the quote's beginning at the page's end, or
 * its ending at the page's start (or all of the page, if the quote runs on
 * through it).
 */
import { foldText, rawRangeOf, type TextRange } from "./page-text-fold";

/**
 * The least part of a quote worth painting on a page it merely touches. It
 * keeps a stray word that happens to end a page (and begins the quote) from
 * lighting up; a few words of a real quote still show.
 */
export const MIN_EDGE_CHARS = 16;

/**
 * Where, in the raw page text, the longest part of `quote` that sits at an
 * edge of the page is; undefined when none is `MIN_EDGE_CHARS` long. Matching
 * ignores case and whitespace like the search for the whole quote does.
 */
export function findQuoteAtPageEdge(
  pageText: string,
  quote: string,
): TextRange | undefined {
  const page = foldText(pageText);
  const needle = foldText(quote).text;
  const found = [
    quoteStartAtPageEnd(page.text, needle),
    quoteEndAtPageStart(page.text, needle),
    pageInsideQuote(page.text, needle),
  ].reduce<TextRange | undefined>(longer, undefined);
  return found && rawRangeOf(page, found.start, found.end);
}

/** The beginning of the quote is the end of the page. */
function quoteStartAtPageEnd(
  page: string,
  quote: string,
): TextRange | undefined {
  // Never the whole quote: that is the ordinary search's to find.
  const longest = Math.min(quote.length - 1, page.length);
  for (let length = longest; length >= MIN_EDGE_CHARS; length--) {
    if (page.endsWith(quote.slice(0, length))) {
      return { start: page.length - length, end: page.length };
    }
  }
  return undefined;
}

/** The ending of the quote is the beginning of the page. */
function quoteEndAtPageStart(
  page: string,
  quote: string,
): TextRange | undefined {
  const longest = Math.min(quote.length - 1, page.length);
  for (let length = longest; length >= MIN_EDGE_CHARS; length--) {
    if (page.startsWith(quote.slice(quote.length - length))) {
      return { start: 0, end: length };
    }
  }
  return undefined;
}

/** The quote runs through the page: the page's text is part of it. */
function pageInsideQuote(page: string, quote: string): TextRange | undefined {
  if (page.length < MIN_EDGE_CHARS || page.length >= quote.length) {
    return undefined;
  }
  return quote.includes(page) ? { start: 0, end: page.length } : undefined;
}

function longer(
  best: TextRange | undefined,
  candidate: TextRange | undefined,
): TextRange | undefined {
  if (!candidate) {
    return best;
  }
  return !best || candidate.end - candidate.start > best.end - best.start
    ? candidate
    : best;
}
