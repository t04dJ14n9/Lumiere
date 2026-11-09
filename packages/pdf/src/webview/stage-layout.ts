import type { StageSettings } from "@embedpdf/react/stage";
import type { ViewChoices } from "../shared/view-settings";
import { nativeSpread } from "./spread-mode";

/** The Stage settings that carry the view choices. */
export type LayoutSettings = Pick<
  StageSettings,
  "flow" | "layout" | "spread" | "fitAlign"
>;

/**
 * What the Stage is asked for, for the reader's choices. Pages that fit rest
 * at the start of the way they run (the top, in a column) and are centred
 * across it, as the viewer has always shown them: the Stage's own default
 * centres them both ways, which floats a short page in the middle of a tall
 * viewer.
 */
export function layoutSettings(choices: ViewChoices): LayoutSettings {
  const horizontal = choices.scrollDirection === "horizontal";
  return {
    flow: choices.scrollMode === "paged" ? "paged" : "continuous",
    layout: horizontal ? "horizontal" : "vertical",
    spread: nativeSpread(choices.pageLayout),
    fitAlign: horizontal
      ? { x: "start", y: "center" }
      : { x: "center", y: "start" },
  };
}

/** Whether the Stage already has the layout the choices ask for. */
export function layoutApplied(
  settings: LayoutSettings,
  choices: ViewChoices,
): boolean {
  const wanted = layoutSettings(choices);
  return (
    settings.flow === wanted.flow &&
    settings.layout === wanted.layout &&
    settings.spread === wanted.spread
  );
}
