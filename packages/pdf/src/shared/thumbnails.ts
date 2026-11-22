/**
 * Where each page's thumbnail goes in the side panel's list, and how large to
 * draw it. Pure: the webview draws the pictures (`thumbnail-images.ts`).
 */
import type { ItemRange } from "./list-window";

/** A page as it shows, in points: a page turned a quarter has its sides swapped. */
export interface PageShape {
  width: number;
  height: number;
}

export function pageShape(
  size: { width: number; height: number },
  rotation: number,
): PageShape {
  return rotation % 180 === 0
    ? { width: size.width, height: size.height }
    : { width: size.height, height: size.width };
}

/** Space above and below a thumbnail, and the line with its page number. */
export const THUMBNAIL_PADDING = 8;
export const THUMBNAIL_LABEL_HEIGHT = 18;
/** Thumbnails stop growing here, however wide the panel is. */
export const MAX_THUMBNAIL_WIDTH = 192;
/** A page this much taller than wide (a scroll of paper) is cut to it. */
const MAX_ASPECT = 4;

export interface ThumbnailLayout {
  /** Where each cell starts, and the height of the whole list last. */
  offsets: number[];
  /** The picture's height in each cell, in pixels. */
  imageHeights: number[];
}

/** One cell per page, each as high as its picture and the page number under it. */
export function thumbnailLayout(
  pages: readonly PageShape[],
  cellWidth: number,
): ThumbnailLayout {
  const offsets = [0];
  const imageHeights: number[] = [];
  for (const page of pages) {
    const aspect =
      page.width > 0 && page.height > 0
        ? Math.min(MAX_ASPECT, page.height / page.width)
        : Math.SQRT2;
    const imageHeight = Math.max(1, Math.round(cellWidth * aspect));
    imageHeights.push(imageHeight);
    offsets.push(
      offsets[offsets.length - 1]! +
        THUMBNAIL_PADDING * 2 +
        imageHeight +
        THUMBNAIL_LABEL_HEIGHT,
    );
  }
  return { offsets, imageHeights };
}

/** The width pictures are drawn at: a multiple of 16, so a panel dragged a pixel draws nothing again. */
export function thumbnailPixelWidth(
  cssWidth: number,
  pixelRatio: number,
): number {
  return Math.max(
    16,
    Math.ceil((cssWidth * Math.max(1, pixelRatio)) / 16) * 16,
  );
}

/** The width of a picture in a panel `panelWidth` wide (its scrollbar and gutters taken off). */
export function thumbnailCellWidth(panelWidth: number): number {
  return Math.max(
    48,
    Math.min(MAX_THUMBNAIL_WIDTH, Math.floor(panelWidth) - 2 * 16 - 10),
  );
}

/**
 * The pages to draw, the ones nearest the middle of the view first: what the
 * reader looks at before what is only close.
 */
export function drawOrder(range: ItemRange): number[] {
  const pages = Array.from(
    { length: Math.max(0, range.end - range.first) },
    (_, offset) => range.first + offset,
  );
  const middle = (range.first + range.end - 1) / 2;
  return pages.sort(
    (a, b) => Math.abs(a - middle) - Math.abs(b - middle) || a - b,
  );
}
