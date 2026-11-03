/**
 * Capture-phase Annotate click selection for EmbedPDF marks. Only text-markup
 * subtypes (highlight / underline / squiggly / strikeout) may steal the click
 * via stopImmediatePropagation — ink, stamp, and large shape rects must not
 * block starting a new Highlight.
 */

/** EmbedPDF PdfAnnotationSubtype values for text markup. */
export const EMBEDDED_CLICK_SELECT_TYPES: ReadonlySet<number> = new Set([
  9, // HIGHLIGHT
  10, // UNDERLINE
  11, // SQUIGGLY
  12, // STRIKEOUT
]);

/** How far outside a mark's lines a click still selects it, in PDF points. */
export const EMBEDDED_HIT_SLOP = 4;
/** Looser hit against the union box of all segment lines. */
export const EMBEDDED_BOUNDS_SLOP = 2;

export function isEmbeddedClickSelectType(type: unknown): boolean {
  return typeof type === "number" && EMBEDDED_CLICK_SELECT_TYPES.has(type);
}

export type EmbeddedSelectHit = { pageIndex: number; id: string };

export type EmbeddedSelectAnnotation = {
  object: {
    id: string;
    pageIndex: number;
    type?: unknown;
    rect?: {
      origin: { x: number; y: number };
      size: { width: number; height: number };
    };
    segmentRects?: Array<{
      origin: { x: number; y: number };
      size: { width: number; height: number };
    }>;
  };
};

type PageHit = { pageIndex: number; px: number; py: number };

function rectsHit(
  rects: Array<{ x: number; y: number; w: number; h: number }>,
  px: number,
  py: number,
): boolean {
  if (
    rects.some(
      (r) =>
        px >= r.x - EMBEDDED_HIT_SLOP &&
        px <= r.x + r.w + EMBEDDED_HIT_SLOP &&
        py >= r.y - EMBEDDED_HIT_SLOP &&
        py <= r.y + r.h + EMBEDDED_HIT_SLOP,
    )
  ) {
    return true;
  }
  if (rects.length === 0) {
    return false;
  }
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.w));
  const bottom = Math.max(...rects.map((r) => r.y + r.h));
  return (
    px >= left - EMBEDDED_BOUNDS_SLOP &&
    px <= right + EMBEDDED_BOUNDS_SLOP &&
    py >= top - EMBEDDED_BOUNDS_SLOP &&
    py <= bottom + EMBEDDED_BOUNDS_SLOP
  );
}

/**
 * Newest-on-top text-markup mark under a page point, if any. Ignores ink /
 * stamp / shapes so Highlight-tool clicks are not captured.
 */
export function findEmbeddedSelectHit(
  annotations: readonly EmbeddedSelectAnnotation[],
  { px, py }: PageHit,
): EmbeddedSelectHit | undefined {
  for (let i = annotations.length - 1; i >= 0; i -= 1) {
    const object = annotations[i]?.object;
    if (!object || !isEmbeddedClickSelectType(object.type)) {
      continue;
    }
    const segments = object.segmentRects?.map((r) => ({
      x: r.origin.x,
      y: r.origin.y,
      w: r.size.width,
      h: r.size.height,
    }));
    if (segments && segments.length > 0 && rectsHit(segments, px, py)) {
      return { pageIndex: object.pageIndex, id: object.id };
    }
    if (object.rect) {
      const { origin, size } = object.rect;
      if (
        rectsHit(
          [{ x: origin.x, y: origin.y, w: size.width, h: size.height }],
          px,
          py,
        )
      ) {
        return { pageIndex: object.pageIndex, id: object.id };
      }
    }
  }
  return undefined;
}
