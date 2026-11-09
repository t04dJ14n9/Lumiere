/** The narrowest whole-page picture, in device pixels: enough for a 1x screen's pane. */
export const MIN_PICTURE_WIDTH = 1280;

/**
 * The widest, whatever the screen: a letter page this wide is 49 MB decoded,
 * and the viewer keeps a few pages' pictures at once.
 */
export const MAX_PICTURE_WIDTH = 3072;

/** The viewer's pane, as the page sees it. */
export interface PaneSize {
  /** CSS pixels across. */
  cssWidth: number;
  /** Device pixels per CSS pixel. */
  pixelRatio: number;
}

/**
 * How wide the picture of a whole page may be drawn: as many device pixels as
 * the pane has across, so a page at fit width is one picture and needs no
 * tiles over it.
 *
 * That matters to scrolling more than to memory. While tiles are wanted
 * (the picture has fewer pixels than the screen shows), every wheel event
 * makes the Stage plan the visible part of each page again, and each new plan
 * draws the whole tree of the page's layers a second time. Without them the
 * plan does not change as the page moves. A 2x screen with a 1200 px pane
 * wants 2400: with a picture 1280 wide, tiles were always engaged there.
 */
export function pagePictureWidth(pane: PaneSize): number {
  const wanted = Math.round(pane.cssWidth * pane.pixelRatio);
  if (!Number.isFinite(wanted)) {
    return MIN_PICTURE_WIDTH;
  }
  return Math.min(MAX_PICTURE_WIDTH, Math.max(MIN_PICTURE_WIDTH, wanted));
}
