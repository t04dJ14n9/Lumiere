import type { Annotation } from "@embedpdf/react/annotation";
import { useEffect, useState } from "react";
import { annotationKey } from "@embedpdf/engine-core/public";
import type { PageRect } from "../../shared/geometry";
import { oneLine, QUOTE_EXCERPT } from "../../shared/annotation-rows";
import { RecentCache } from "../../shared/recent-cache";
import { readText } from "../region-details";
import { useTextAccess, type TextAccess } from "../text-access";

/** Quotes kept, so a list scrolled back over is not read from the pages again. */
const KEPT_QUOTES = 500;
const quotes = new RecentCache<string, string>(KEPT_QUOTES);

/**
 * The text a text mark covers: the characters inside each of its boxes,
 * read from the page. Missing while it is being read, and for a PDF that
 * forbids copying its text. The row that needs it asks (the rows on screen),
 * so a PDF with thousands of marks reads only the few it shows.
 */
export function useQuotedText(
  mark: Annotation,
  wanted: boolean,
): string | undefined {
  const access = useTextAccess();
  const key = annotationKey(mark.ref);
  const [quote, setQuote] = useState(() => quotes.get(key));
  useEffect(() => {
    const kept = quotes.get(key);
    if (kept !== undefined || !wanted || !access) {
      setQuote(kept);
      return;
    }
    let current = true;
    void readQuote(access, mark).then((text) => {
      if (text !== undefined) {
        quotes.set(key, text);
      }
      if (current) {
        setQuote(text);
      }
    });
    return () => {
      current = false;
    };
  }, [access, key, mark, wanted]);
  return quote;
}

/** Never rejects: a page whose text cannot be read quotes nothing. */
async function readQuote(
  access: TextAccess,
  mark: Annotation,
): Promise<string | undefined> {
  const boxes = quoteBoxes(mark);
  const lines = await Promise.all(
    boxes.map((box) => readText(access, mark.page, box)),
  );
  return oneLine(lines.join(" "), QUOTE_EXCERPT);
}

/** One box a line: the corners of each quad of a text mark, as a page rectangle. */
function quoteBoxes(mark: Annotation): PageRect[] {
  const quads =
    "quadPoints" in mark && Array.isArray(mark.quadPoints)
      ? mark.quadPoints
      : [];
  return quads.map((quad) => {
    const xs = [
      quad.upperLeft.x,
      quad.upperRight.x,
      quad.lowerLeft.x,
      quad.lowerRight.x,
    ];
    const ys = [
      quad.upperLeft.y,
      quad.upperRight.y,
      quad.lowerLeft.y,
      quad.lowerRight.y,
    ];
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  });
}
