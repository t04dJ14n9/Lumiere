import type {
  PageDestination,
  PageRef,
  PdfLinkTarget,
} from "@embedpdf/engine-core/runtime";

/**
 * Where a PDF names a page: a link's or a bookmark's target, as EmbedPDF
 * reads it. A `/Dest` and a `/A` Go To both read as `goto`.
 */
export type LinkTarget = PdfLinkTarget | null | undefined;

/** The place inside the PDF a bookmark or link opens, if it opens one. */
export function targetDestination(
  target: LinkTarget,
): PageDestination | undefined {
  return target?.kind === "goto" ? target.destination : undefined;
}

/**
 * The 1-based page a bookmark or link opens, if it points inside the PDF.
 * External links (URLs, other files) have none.
 *
 * EmbedPDF names a page by identity, not by its position, so the caller says
 * where a page is (`pageNumberOf`): undefined for a page the document no
 * longer has.
 */
export function targetPage(
  target: LinkTarget,
  pageNumberOf: (page: PageRef) => number | undefined,
): number | undefined {
  const destination = targetDestination(target);
  return destination ? pageNumberOf(destination.page) : undefined;
}

/**
 * How far down its page a bookmark or link opens, in points from the top,
 * for destinations that name a height (a heading or reference halfway down
 * a page). Undefined means the top of the page.
 *
 * Destinations are already in page space, measured down from the top of the
 * page, and `y` is null where the file leaves the height out. A destination
 * above the page opens at its top.
 */
export function targetTop(target: LinkTarget): number | undefined {
  const destination = targetDestination(target);
  switch (destination?.kind) {
    case "xyz":
    case "fitH":
    case "fitBH":
      return destination.y === null ? undefined : Math.max(0, destination.y);
    default:
      return undefined;
  }
}

/** The web address a link opens, if it is a URI action. */
export function targetUrl(target: LinkTarget): string | undefined {
  return target?.kind === "uri" ? target.uri : undefined;
}
