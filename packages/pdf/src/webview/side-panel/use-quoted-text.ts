import type { Annotation } from "@embedpdf/react/annotation";
import { useEffect, useState } from "react";
import { annotationKey } from "@embedpdf/engine-core/public";
import { oneLine, QUOTE_EXCERPT } from "../../shared/annotation-rows";
import { quoteBoxes, readBoxesText } from "../../shared/region-reader";
import { ScopedCache } from "../../shared/scoped-cache";
import { annotationLoadState } from "../annotation-load-state";
import { regionPage } from "../region-details";
import { useTextAccess, type TextAccess } from "../text-access";

/**
 * Quotes kept, so a list scrolled back over is not read from the pages again.
 * They belong to one load of the PDF: a reloaded file keeps page and object
 * numbers, and its marks must not quote the old file's text.
 */
const KEPT_QUOTES = 500;
const quotes = new ScopedCache<string>(KEPT_QUOTES);

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
  const load = annotationLoadState()?.load;
  const [quote, setQuote] = useState(() => quotes.get(load, key));
  useEffect(() => {
    const kept = quotes.get(load, key);
    if (kept !== undefined || !wanted || !access) {
      setQuote(kept);
      return;
    }
    let current = true;
    void readQuote(access, mark).then((text) => {
      if (text !== undefined) {
        quotes.set(load, key, text);
      }
      if (current) {
        setQuote(text);
      }
    });
    return () => {
      current = false;
    };
  }, [access, key, load, mark, wanted]);
  return quote;
}

/** Never rejects: a page whose text cannot be read quotes nothing. */
async function readQuote(
  access: TextAccess,
  mark: Annotation,
): Promise<string | undefined> {
  const text = await readBoxesText(
    regionPage(access, mark.page),
    quoteBoxes(mark),
  );
  return oneLine(text, QUOTE_EXCERPT);
}
