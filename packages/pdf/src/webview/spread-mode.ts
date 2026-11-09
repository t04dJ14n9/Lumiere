import type { SpreadMode } from "@embedpdf/react/stage";
import type { PageLayout } from "../shared/view-settings";

/** Native odd spreads start with 1–2; even spreads leave page 1 alone. */
export function nativeSpread(pageLayout: PageLayout): SpreadMode {
  switch (pageLayout) {
    case "single":
      return "none";
    case "spread":
      return "odd";
    case "spreadCover":
      return "even";
  }
}
