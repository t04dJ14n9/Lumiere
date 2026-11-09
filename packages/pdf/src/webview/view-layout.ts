import { useEffect } from "react";
import type { ViewChoices } from "../shared/view-settings";
import { layoutApplied, layoutSettings } from "./stage-layout";
import { useStageApi } from "./stage-capability";

/**
 * Give the Stage the reader's page layout, scrolling and direction, and keep
 * them on their page, at its top. A change of flow, layout or spread is one
 * Stage update that keeps the page but leaves the view wherever the corner
 * held, so the page is gone to again. The Stage is registered with the saved
 * choices, so opening changes nothing.
 */
export function useViewLayout(choices: ViewChoices, smooth: boolean): void {
  const stage = useStageApi();
  const { scrollMode, scrollDirection, pageLayout } = choices;
  useEffect(() => {
    const wanted = { scrollMode, scrollDirection, pageLayout };
    if (layoutApplied(stage.getSettings(), wanted)) {
      return;
    }
    const page = stage.getCurrentPageIndex();
    stage.updateSettings(layoutSettings(wanted));
    stage.goToPage(page, { behavior: "instant" });
  }, [stage, scrollMode, scrollDirection, pageLayout]);
  // Navigation animates in continuous scrolling only: in paged scrolling a
  // tween would slide between two pages' own cameras.
  const scrollBehavior =
    smooth && scrollMode === "continuous" ? "smooth" : "instant";
  useEffect(() => {
    if (stage.getSettings().scrollBehavior !== scrollBehavior) {
      stage.updateSettings({ scrollBehavior });
    }
  }, [stage, scrollBehavior]);
}
