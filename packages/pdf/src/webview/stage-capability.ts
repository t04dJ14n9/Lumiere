import { useCapability } from "@embedpdf/react/runtime";
import { StageToken } from "@embedpdf/plugin-stage/contract/host";

/**
 * The Stage's API for the viewer's hooks: the host view of the capability
 * (`getScrollMetrics` and friends), the same object `useStage()` returns.
 *
 * Like `useStage()`, it works only under a ready document: before one, it is
 * a stand-in whose every call throws. The Viewer is mounted inside
 * `<DocumentGate>`, so its hooks always have the real one.
 */
export function useStageApi() {
  return useCapability(StageToken);
}

export type StageApi = ReturnType<typeof useStageApi>;
