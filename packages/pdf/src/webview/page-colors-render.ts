import { useRender } from "@embedpdf/react/render";
import { useEffect } from "react";
import { currentPageColors, onPageColorsChange } from "./page-colors";

/**
 * Draw the pages again when the page colours change. EmbedPDF keeps a page's
 * pictures until something says its pixels changed, and its pictures are
 * drawn in the colours the engine had when they were asked for: after the
 * engine has been told the new ones (page-colors.ts does that first), every
 * picture is invalidated and asked for again.
 */
export function useRepaintOnPageColors(): void {
  const render = useRender();
  useEffect(() => {
    let drawn = currentPageColors();
    return onPageColorsChange(() => {
      const now = currentPageColors();
      // The host says the colours again whenever a viewer loads, and the
      // viewer hears it twice (host.ts): only a change redraws.
      if (now !== drawn) {
        drawn = now;
        render.invalidate();
      }
    });
  }, [render]);
}
