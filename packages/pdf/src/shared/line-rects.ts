/**
 * The box of one line of a passage, which a backlink overlay paints. Pure
 * data; the viewer reads the passage's boxes from the page's text layout.
 */

/** One line's box of a passage, in points from the page's top-left. */
export interface SegmentRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
