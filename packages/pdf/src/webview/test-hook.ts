import { useEffect } from "react";
import { useStageApi } from "./stage-capability";

/**
 * Browser specs read the view through the Stage (its scroll offsets, camera
 * and visible pages), because the Stage has no scrolling element to measure.
 * The harness (test/browser/harness.html) sets `window.__exposeStage` before
 * the viewer loads; VS Code never does, so a real webview exposes nothing.
 */
export function useExposeStageForTests(): void {
  const stage = useStageApi();
  useEffect(() => {
    const target = window as unknown as Record<string, unknown>;
    if (!target.__exposeStage) {
      return;
    }
    target.__stage = stage;
    return () => {
      delete target.__stage;
    };
  }, [stage]);
}
