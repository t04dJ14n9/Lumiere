import {
  PdfActionType,
  type PdfDestinationObject,
  type PdfLinkTarget,
} from "@embedpdf/models";

/** The place inside the PDF a bookmark or link opens, if it opens one. */
export function targetDestination(
  target: PdfLinkTarget | undefined,
): PdfDestinationObject | undefined {
  if (!target) {
    return undefined;
  }
  if (target.type === "destination") {
    return target.destination;
  }
  return target.action.type === PdfActionType.Goto
    ? target.action.destination
    : undefined;
}

/**
 * The 1-based page a bookmark or link opens, if it points inside the PDF.
 * External links (URLs, other files) have none.
 */
export function targetPage(
  target: PdfLinkTarget | undefined,
): number | undefined {
  const destination = targetDestination(target);
  return destination ? destination.pageIndex + 1 : undefined;
}
