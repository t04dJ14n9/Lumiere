import type { PageRef } from "@embedpdf/engine";

/**
 * A page on screen, as Look Up finds the one under the pointer. EmbedPDF 3
 * puts no `data-page-index` on its pages and draws them in a camera, so each
 * page layer (look-up-word.tsx) says where its page is.
 */
export interface LookUpPage {
  pageIndex: number;
  ref: PageRef;
  /** The page's size in points. */
  size: { width: number; height: number };
  /**
   * A window point as a point on the page in points from its top-left, turned
   * back from the page's /Rotate and its zoom; it may lie outside the page.
   */
  toPagePoint(clientX: number, clientY: number): { x: number; y: number };
}

const pages = new Map<number, LookUpPage>();

/** Say where a page is while its layer is mounted; returns how to stop. */
export function registerLookUpPage(page: LookUpPage): () => void {
  pages.set(page.ref.objectNumber, page);
  return () => {
    if (pages.get(page.ref.objectNumber) === page) {
      pages.delete(page.ref.objectNumber);
    }
  };
}

/** The page under a window point, and the point in the page's own points. */
export function lookUpPageAt(
  x: number,
  y: number,
): { page: LookUpPage; point: { x: number; y: number } } | undefined {
  for (const page of pages.values()) {
    const point = page.toPagePoint(x, y);
    if (
      point.x >= 0 &&
      point.y >= 0 &&
      point.x <= page.size.width &&
      point.y <= page.size.height
    ) {
      return { page, point };
    }
  }
  return undefined;
}
