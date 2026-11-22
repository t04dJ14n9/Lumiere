import { useState, type Dispatch, type SetStateAction } from "react";
import type { PdfLocation } from "../shared/pdf-location";
import type { ViewChoices } from "../shared/view-settings";
import type { Navigation } from "./navigation";
import type { useJumpHistory } from "./jump-history";
import { currentViewSettings, rememberedPosition } from "./reading-position";

type JumpHistory = ReturnType<typeof useJumpHistory>;

/** The remembered page layout and scrolling of this PDF. */
export function rememberedChoices(): ViewChoices {
  const position = rememberedPosition();
  return {
    pageLayout: position.pageLayout,
    scrollMode: position.scrollMode,
    scrollDirection: position.scrollDirection,
  };
}

/**
 * Navigation whose page and box moves are history entries: deliberate ones
 * jump, a search's passive reveal is a preview.
 */
export function withHistory(navigation: Navigation, history: JumpHistory) {
  return {
    ...navigation,
    /** A deliberate move to a place on a page (a panel row, a bookmark). */
    jumpTo: (location: PdfLocation, top?: number, left?: number) =>
      history.jump(() => navigation.show(location, top, left)),
    goToPage: (page: number, top?: number) =>
      history.jump(() => navigation.goToPage(page, top)),
    reveal: (
      page: number,
      rect: Parameters<Navigation["reveal"]>[1],
      deliberate = true,
    ) => {
      if (deliberate) {
        history.jump(() => navigation.reveal(page, rect), undefined, true);
      } else {
        history.preview(() => navigation.reveal(page, rect));
      }
    },
  };
}

/** Empty-page / Select Region setting mirrored into React state. */
export function useRegionsEnabled(): [
  boolean,
  Dispatch<SetStateAction<boolean>>,
] {
  return useState(() => currentViewSettings().regionsEnabled);
}
